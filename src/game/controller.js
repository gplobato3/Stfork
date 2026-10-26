/**
 * @file src/game/controller.js
 * GLUE: the single owner of the live WorldState. Implements ControllerAPI
 * (src/contract/interfaces.js) on top of the engine (rules), the LLM layer,
 * the SillyTavern bridge and the UI.
 *
 * Invariants:
 *  - Every state change is persisted to the current chat before the UI shows it.
 *  - Long flows (end turn, new campaign, chat orders) hold `busy` and release it in `finally`.
 *  - A chat switch bumps `epoch`; async flows started in the old chat stop before
 *    writing, so a campaign can never leak into another chat's metadata.
 *  - Nothing here throws into SillyTavern: failures become pt-BR toasts.
 */

import { PHASES } from '../contract/constants.js';
import { formatDate } from '../contract/presentation.js';
import { playerNation } from '../contract/worldState.js';

const BUSY_LABELS = Object.freeze({
    newGame: 'Formando o governo…',
    turn: 'O mundo se move…',
    event: 'O gabinete prepara o despacho do mês…',
    bulletin: 'Redigindo o boletim internacional…',
    orders: 'O gabinete interpreta a sua ordem…',
});

/**
 * @param {{
 *   engine: import('../contract/interfaces.js').EngineAPI,
 *   scenario: import('../contract/interfaces.js').ScenarioAPI,
 *   llm: import('../contract/interfaces.js').LlmAPI,
 *   st: import('../contract/interfaces.js').StAPI,
 *   getUi: () => import('../contract/interfaces.js').UiAPI,
 *   seedSource?: () => string,
 * }} deps
 * @returns {import('../contract/interfaces.js').ControllerAPI & {
 *   handleChatOrder: (text: string) => Promise<string[]>,
 *   query: import('../contract/interfaces.js').UiQuery,
 * }}
 */
export function createController(deps) {
    const { engine, scenario, llm, st, getUi } = deps;
    const seedSource = deps.seedSource || (() => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`);

    /** @type {?import('../contract/worldState.js').WorldState} */
    let state = null;
    let busy = false;
    let epoch = 0;
    let started = false;
    /** campaignId:turn of the last outcome shown, so the game-over dialog appears once. */
    let shownOutcome = null;

    const ui = () => getUi();

    /* ------------------------------------------------------------ helpers */

    function toast(msg, kind = 'info') {
        try {
            ui().toast(msg, kind);
        } catch {
            st.toast(msg, kind);
        }
    }

    function uiSafe(fn) {
        try {
            return fn(ui());
        } catch (error) {
            console.error('[HOI] UI call failed', error);
            return undefined;
        }
    }

    function hasCampaign() {
        return !!(state && state.player && playerNation(state));
    }

    function isOver() {
        return !!state && state.phase === PHASES.GAME_OVER;
    }

    function settings() {
        try {
            return st.getSettings();
        } catch {
            return { postBulletins: true, llmEvents: true };
        }
    }

    /** Commit a new state: memory -> chat metadata -> injection -> UI. Returns false if the chat changed. */
    async function commit(next, myEpoch) {
        if (myEpoch !== epoch) return false;
        state = next;
        try {
            await st.saveCampaign(state);
        } catch (error) {
            console.error('[HOI] save failed', error);
            toast('Não foi possível salvar a campanha neste chat.', 'error');
        }
        if (myEpoch !== epoch) return false;
        try {
            st.refreshInjection(state);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
        uiSafe((u) => u.refresh());
        return true;
    }

    function setBusy(on, label) {
        busy = !!on;
        uiSafe((u) => u.setBusy(busy, label));
    }

    /** Run `fn` holding the busy lock; returns undefined when already busy. */
    async function withBusy(label, fn) {
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return undefined;
        }
        setBusy(true, label);
        try {
            return await fn();
        } catch (error) {
            console.error('[HOI] action failed', error);
            toast(`Algo deu errado: ${error && error.message ? error.message : error}`, 'error');
            return undefined;
        } finally {
            setBusy(false);
        }
    }

    function loadFromChat() {
        let raw = null;
        try {
            raw = st.loadCampaign();
        } catch (error) {
            console.warn('[HOI] loadCampaign failed', error);
        }
        if (!raw) return null;
        const migrated = engine.migrate(raw);
        if (!migrated) {
            toast('Este chat tem uma campanha de uma versão anterior da extensão, que não é compatível. Inicie uma nova campanha.', 'warning');
        }
        return migrated;
    }

    async function maybeShowOutcome() {
        if (!state || !state.outcome) return;
        const key = `${state.campaignId}:${state.outcome.turn}`;
        if (shownOutcome === key) return;
        shownOutcome = key;
        const nation = playerNation(state);
        if (settings().postBulletins) {
            const verdict = state.outcome.kind === 'victory' ? 'VITÓRIA' : 'DERROTA';
            await safePost(`**${verdict} — ${formatDate(state.date)}**\n\n${state.outcome.reason}${nation ? `\n\nFim do governo de ${state.player.title} ${state.player.leaderName} (${nation.name}).` : ''}`);
        }
        await uiSafe((u) => u.showGameOver({ kind: state.outcome.kind, reason: state.outcome.reason }));
    }

    async function safePost(text) {
        try {
            await st.postNarrator(text);
        } catch (error) {
            console.warn('[HOI] postNarrator failed', error);
        }
    }

    /** Deterministic bulletin used when the LLM is off or fails. */
    function fallbackBulletin(report, decisions) {
        const lines = [`**Boletim Internacional — ${formatDate(report.date)}**`, ''];
        for (const h of (report.headlines || []).slice(0, 5)) lines.push(`- ${h}`);
        for (const d of decisions) lines.push(`- Decisão do governo: ${d.eventTitle} — ${d.optionLabel}.`);
        return lines.length > 2 ? lines.join('\n') : '';
    }

    /* ---------------------------------------------------------- decisions */

    /**
     * Show the pending decision and everything queued behind it. Stops when the
     * player postpones ("Decidir depois"), the chat changes, or the game ends.
     * @returns {Promise<Array<{eventTitle:string, optionLabel:string}>>}
     */
    async function presentDecisions(myEpoch) {
        const decisions = [];
        for (let guard = 0; guard < 12; guard++) {
            if (myEpoch !== epoch || !state || isOver()) break;
            const ev = state.pendingEvent || (state.eventQueue && state.eventQueue[0]);
            if (!ev) break;
            const choice = await uiSafe((u) => u.showEvent(ev, { dismissible: true }));
            if (myEpoch !== epoch) break;
            if (typeof choice !== 'number') break;
            const option = ev.options && ev.options[choice];
            const { state: next, summary, details } = engine.resolvePendingEvent(state, choice);
            if (!(await commit(next, myEpoch))) break;
            if (option) decisions.push({ eventTitle: ev.title, optionLabel: option.label });
            toast([summary, ...(details || []).slice(0, 4)].join(' · '), 'info');
            if (isOver()) break;
        }
        return decisions;
    }

    /* --------------------------------------------------------- lifecycle */

    async function start() {
        epoch += 1;
        state = loadFromChat();
        try {
            st.refreshInjection(state);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
        if (!started) {
            started = true;
            await uiSafe((u) => u.mount());
            // Warm the scenario cache in the background (wizard opens instantly later).
            scenario.load().catch((error) => console.warn('[HOI] scenario preload failed', error));
        }
        uiSafe((u) => u.refresh());
    }

    async function onChatChanged() {
        epoch += 1;
        busy = false;
        uiSafe((u) => u.setBusy(false));
        state = loadFromChat();
        shownOutcome = state && state.outcome ? `${state.campaignId}:${state.outcome.turn}` : null;
        try {
            st.refreshInjection(state);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
        uiSafe((u) => u.refresh());
    }

    async function openWarRoom() {
        await uiSafe((u) => u.openWarRoom());
    }

    /* ------------------------------------------------------- new campaign */

    async function newCampaign() {
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return;
        }
        const myEpoch = epoch;
        if (hasCampaign() && !isOver()) {
            const ok = await uiSafe((u) => u.confirm({
                title: 'Substituir a campanha deste chat?',
                text: 'Este chat já tem uma campanha em andamento. Começar outra apaga a atual (a conversa continua intacta).',
                okLabel: 'Nova campanha',
            }));
            if (!ok || myEpoch !== epoch) return;
        }
        let data;
        try {
            data = await scenario.load();
        } catch (error) {
            console.error('[HOI] scenario load failed', error);
            toast('Não foi possível carregar o cenário. Verifique se a extensão foi instalada por completo.', 'error');
            return;
        }
        const choice = await uiSafe((u) => u.showNewCampaignWizard(data, { defaultLeaderName: st.personaName() }));
        if (!choice || myEpoch !== epoch) return;

        await withBusy(BUSY_LABELS.newGame, async () => {
            const fresh = engine.newGame(data, {
                bookmarkId: choice.bookmarkId,
                nationId: choice.nationId,
                leaderName: choice.leaderName || st.personaName(),
                difficulty: choice.difficulty || settings().difficulty || 'normal',
                seed: seedSource(),
            });
            shownOutcome = null;
            if (!(await commit(fresh, myEpoch))) return;
            const nation = playerNation(state);
            const bookmark = (data.bookmarks || []).find((b) => b.id === choice.bookmarkId);
            if (settings().postBulletins && nation) {
                const intro = [
                    `**${formatDate(state.date)} — ${state.player.title} ${state.player.leaderName} assume o governo: ${nation.name}.**`,
                    bookmark && bookmark.description ? bookmark.description : '',
                    nation.capital ? `O gabinete aguarda as suas ordens em ${nation.capital}.` : 'O gabinete aguarda as suas ordens.',
                ].filter(Boolean).join('\n\n');
                await safePost(intro);
            }
            toast(`Campanha iniciada: ${nation ? nation.name : ''}, ${formatDate(state.date)}.`, 'success');
        });
        if (myEpoch !== epoch || !hasCampaign()) return;
        await openWarRoom();
        if (state.pendingEvent || (state.eventQueue && state.eventQueue.length)) {
            await openPendingEvent();
        }
    }

    /* ------------------------------------------------------------ actions */

    /**
     * Execute a catalog action for the player.
     * @returns {Promise<?import('../contract/events.js').ActionResult>}
     */
    async function doAction(actionId, targetId = null, source = 'ui') {
        if (!hasCampaign()) {
            toast('Nenhuma campanha neste chat. Use "Nova Campanha" para começar.', 'warning');
            return null;
        }
        if (isOver()) {
            toast('A campanha terminou.', 'warning');
            return null;
        }
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return null;
        }
        const myEpoch = epoch;
        const { state: next, result } = engine.executeAction(state, state.player.nationId, actionId, targetId || null, { source });
        if (result.ok) {
            if (!(await commit(next, myEpoch))) return result;
        }
        // Typed slash commands (/hoi-acao) need visible feedback too: ST discards the
        // pipe value of a command run from the chat input (only STscript reads it).
        if (source === 'ui' || source === 'command') uiSafe((u) => u.showActionResult(result));
        await maybeShowOutcome();
        return result;
    }

    /**
     * Interpret a free-form order and execute the matched catalog actions.
     * @param {string} text
     * @param {'chat'|'warroom'|'command'} source
     * @returns {Promise<import('../contract/events.js').ActionResult[]>}
     */
    async function handleOrder(text, source = 'warroom') {
        const message = String(text || '').trim();
        if (!message) return [];
        if (!hasCampaign() || isOver()) {
            if (source !== 'chat') toast('Nenhuma campanha ativa neste chat.', 'warning');
            return [];
        }
        if (busy) {
            if (source === 'chat') toast('Ordens desta mensagem ignoradas: o turno ainda estava sendo processado.', 'warning');
            else toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return [];
        }
        const myEpoch = epoch;
        const run = async () => {
            const { orders, error } = await llm.interpretOrders(state, message);
            if (myEpoch !== epoch) return [];
            if (!orders.length) {
                if (error) toast(error, 'warning');
                else if (source !== 'chat') toast('O gabinete não identificou nenhuma ordem executável nesse texto.', 'info');
                return [];
            }
            const results = [];
            let next = state;
            for (const order of orders) {
                const out = engine.executeAction(next, next.player.nationId, order.actionId, order.targetId, { source: 'order' });
                results.push(out.result);
                if (out.result.ok) next = out.state;
            }
            await commit(next, myEpoch);
            for (const r of results) uiSafe((u) => u.showActionResult(r));
            return results;
        };
        // Chat orders run inside the generate interceptor: the user's reply is already
        // waiting, so keep the UI usable and do not flash the War Room busy overlay.
        const results = source === 'chat' ? await guarded(run) : await withBusy(BUSY_LABELS.orders, run);
        await maybeShowOutcome();
        return results || [];
    }

    async function guarded(fn) {
        busy = true;
        try {
            return await fn();
        } catch (error) {
            console.error('[HOI] chat order failed', error);
            return [];
        } finally {
            busy = false;
            // commit()/showActionResult() refreshed the UI while `busy` was still true;
            // without this the HUD keeps "Avançar Mês" disabled ("Processando…").
            uiSafe((u) => u.refresh());
        }
    }

    /** StAPI deps.onUserOrder: returns pt-BR summaries (the sitrep carries the details). */
    async function handleChatOrder(text) {
        const results = await handleOrder(text, 'chat');
        return results.map((r) => r.summary).filter(Boolean);
    }

    /* ----------------------------------------------------------- end turn */

    async function endTurn() {
        if (!hasCampaign()) {
            toast('Nenhuma campanha neste chat. Use "Nova Campanha" para começar.', 'warning');
            return;
        }
        if (isOver()) {
            await maybeShowOutcome();
            return;
        }
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return;
        }
        if (state.pendingEvent || (state.eventQueue && state.eventQueue.length)) {
            toast('Há decisões pendentes. Resolva-as antes de avançar o mês.', 'warning');
            await openPendingEvent();
            return;
        }
        const myEpoch = epoch;
        let report = null;
        await withBusy(BUSY_LABELS.turn, async () => {
            const out = engine.endTurn(state);
            report = out.report;
            if (!(await commit(out.state, myEpoch))) return;
            uiSafe((u) => u.showTurnReport(report));
            if (isOver()) return;

            setBusy(true, BUSY_LABELS.event);
            let recentChat = '';
            try {
                recentChat = st.recentChatText(8);
            } catch {
                recentChat = '';
            }
            const event = await llm.generateTurnEvent(state, { report, recentChat });
            if (myEpoch !== epoch) return;
            if (event) await commit(engine.setPendingEvent(state, event), myEpoch);
        });
        if (myEpoch !== epoch || !report) return;
        if (isOver()) {
            await maybeShowOutcome();
            return;
        }

        // Decisions: engine events (calls to arms, peace terms...) then the LLM event.
        const decisions = await lockedDecisions(myEpoch);
        if (myEpoch !== epoch) return;

        if (settings().postBulletins && !isOver()) {
            await withBusy(BUSY_LABELS.bulletin, async () => {
                let text = '';
                try {
                    text = await llm.writeBulletin(state, { report, decision: decisions[decisions.length - 1] });
                } catch (error) {
                    console.warn('[HOI] bulletin failed', error);
                }
                if (myEpoch !== epoch) return;
                if (text) text = `**Boletim Internacional — ${formatDate(report.date)}**\n\n${text}`;
                else text = fallbackBulletin(report, decisions);
                if (text) await safePost(text);
            });
        }
        await maybeShowOutcome();
    }

    async function openPendingEvent() {
        if (!hasCampaign()) {
            toast('Nenhuma campanha neste chat.', 'warning');
            return;
        }
        if (!state.pendingEvent && !(state.eventQueue && state.eventQueue.length)) {
            toast('Nenhuma decisão pendente.', 'info');
            return;
        }
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return;
        }
        await lockedDecisions(epoch);
        await maybeShowOutcome();
    }

    /** presentDecisions while holding `busy` (no overlay: the dialog itself is modal). */
    async function lockedDecisions(myEpoch) {
        busy = true;
        try {
            return await presentDecisions(myEpoch);
        } finally {
            if (myEpoch === epoch) busy = false;
            uiSafe((u) => u.refresh());
        }
    }

    /* -------------------------------------------------------- persistence */

    async function save() {
        if (!hasCampaign()) {
            toast('Nenhuma campanha para salvar neste chat.', 'warning');
            return;
        }
        await commit(state, epoch);
        toast('Campanha salva neste chat.', 'success');
    }

    async function reset() {
        if (!state) {
            toast('Este chat não tem campanha.', 'info');
            return;
        }
        if (busy) {
            toast('Aguarde: o gabinete ainda está trabalhando.', 'warning');
            return;
        }
        const myEpoch = epoch;
        const ok = await uiSafe((u) => u.confirm({
            title: 'Apagar a campanha deste chat?',
            text: 'O estado do jogo (mapa, recursos, guerras e decisões) será apagado. As mensagens do chat continuam. Não é possível desfazer.',
            okLabel: 'Apagar campanha',
        }));
        if (!ok || myEpoch !== epoch) return;
        state = null;
        shownOutcome = null;
        try {
            await st.clearCampaign();
        } catch (error) {
            console.error('[HOI] clearCampaign failed', error);
        }
        uiSafe((u) => u.refresh());
        toast('Campanha apagada.', 'success');
    }

    /* ------------------------------------------------------------- queries */

    function statusText() {
        if (!hasCampaign()) return '';
        try {
            return llm.buildSitrep(state, { detail: 'full' }) || '';
        } catch {
            return '';
        }
    }

    const query = {
        getState: () => state,
        getPlayerActions: (targetId) => (hasCampaign() ? engine.getAvailableActions(state, state.player.nationId, targetId || null) : []),
        getNationView: (id) => (state ? engine.getNationView(state, id) : null),
        getRanking: () => (state ? engine.getRanking(state) : []),
        getSettings: () => settings(),
        listConnectionProfiles: () => {
            try {
                return st.listConnectionProfiles();
            } catch {
                return [];
            }
        },
        isBusy: () => busy,
    };

    return {
        start,
        openWarRoom,
        newCampaign,
        doAction,
        endTurn,
        openPendingEvent,
        handleOrder,
        handleChatOrder,
        save,
        reset,
        onChatChanged,
        getState: () => state,
        statusText,
        isBusy: () => busy,
        query,
    };
}
