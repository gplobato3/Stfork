/**
 * @file src/game/controller.js
 * GLUE: the single owner of the live WorldState. Implements ControllerAPI
 * (src/contract/interfaces.js) on top of the engine (rules), the LLM layer,
 * the SillyTavern bridge and the UI.
 *
 * Invariants:
 *  - Every state change is persisted to the chat it belongs to before the UI shows it.
 *    StAPI refuses writes while SillyTavern is loading another chat (see writeBlocker
 *    in src/st/index.js); the controller also checks the chat id before committing.
 *  - Long flows hold an owner token on the busy lock. Only the owner can release it, and
 *    a chat switch revokes ownership, so a stale flow can never unlock the new chat.
 *  - A chat switch bumps `epoch`; flows started in the old chat stop before writing.
 *  - Actions marked `confirm: true` (war, strikes, nukes) never run without a dialog:
 *    chat orders refuse them, War Room orders and slash commands ask first.
 *  - Code reachable from the generate interceptor (chat orders) never posts chat
 *    messages or awaits dialogs; the game-over flow waits for GENERATION_ENDED.
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

const BUSY_MSG = 'Aguarde: o gabinete ainda está trabalhando.';

/**
 * @param {{
 *   engine: import('../contract/interfaces.js').EngineAPI,
 *   scenario: import('../contract/interfaces.js').ScenarioAPI,
 *   llm: import('../contract/interfaces.js').LlmAPI,
 *   st: import('../contract/interfaces.js').StAPI,
 *   getUi: () => import('../contract/interfaces.js').UiAPI,
 *   closeDialogs?: () => void,
 *   seedSource?: () => string,
 * }} deps
 * @returns {import('../contract/interfaces.js').ControllerAPI & {
 *   handleChatOrder: (text: string) => Promise<string[]>,
 *   afterGeneration: () => void,
 *   query: import('../contract/interfaces.js').UiQuery,
 * }}
 */
export function createController(deps) {
    const { engine, scenario, llm, st, getUi } = deps;
    const closeDialogs = typeof deps.closeDialogs === 'function' ? deps.closeDialogs : () => {};
    const seedSource = deps.seedSource || (() => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`);

    /** @type {?import('../contract/worldState.js').WorldState} */
    let state = null;
    /** Current owner of the busy lock (null = free). */
    let busyOwner = null;
    let epoch = 0;
    /** Chat the in-memory campaign belongs to. */
    let boundChatId = null;
    /** In-memory state newer than what is saved (a write was refused while ST reloaded the chat). */
    let dirty = false;
    /** A chat order ended the game: show it once the user's generation finishes. */
    let outcomeDeferred = false;
    let started = false;
    /** campaignId:turn of the last outcome shown, so the game-over flow runs once. */
    let shownOutcome = null;
    /** @type {?Map<string, import('../contract/events.js').ActionDef>} */
    let catalogById = null;

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

    const hasCampaign = () => !!(state && state.player && playerNation(state));
    const isOver = () => !!state && state.phase === PHASES.GAME_OVER;
    const hasDecisions = () => !!state && (!!state.pendingEvent || (Array.isArray(state.eventQueue) && state.eventQueue.length > 0));

    function settings() {
        try {
            return st.getSettings();
        } catch {
            return { postBulletins: true, llmEvents: true };
        }
    }

    function chatId() {
        try {
            return st.currentChatId();
        } catch {
            return null;
        }
    }

    function actionDef(id) {
        if (!catalogById) catalogById = new Map(engine.getCatalog().map((d) => [d.id, d]));
        return catalogById.get(id) || null;
    }

    /* --------------------------------------------------------- busy lock */

    /**
     * Take the busy lock. `overlay:false` keeps the War Room usable (dialog flows and
     * chat orders); the HUD/War Room still read isBusy() to disable "Avançar Mês".
     * @returns {?object} owner token, or null when someone else holds the lock
     */
    function acquire(label, { overlay = true } = {}) {
        if (busyOwner) return null;
        const token = { overlay, epoch };
        busyOwner = token;
        if (overlay) uiSafe((u) => u.setBusy(true, label));
        else uiSafe((u) => u.refresh());
        return token;
    }

    function relabel(token, label) {
        if (busyOwner === token && token.overlay) uiSafe((u) => u.setBusy(true, label));
    }

    function release(token) {
        if (!token || busyOwner !== token) return;
        busyOwner = null;
        if (token.overlay) uiSafe((u) => u.setBusy(false));
        uiSafe((u) => u.refresh());
    }

    /** Run `fn(token)` holding the lock; undefined when the lock is taken. */
    async function withBusy(label, fn, opts) {
        const token = acquire(label, opts);
        if (!token) {
            toast(BUSY_MSG, 'warning');
            return undefined;
        }
        try {
            return await fn(token);
        } catch (error) {
            console.error('[HOI] action failed', error);
            toast(`Algo deu errado: ${error && error.message ? error.message : error}`, 'error');
            return undefined;
        } finally {
            release(token);
        }
    }

    /* -------------------------------------------------------- persistence */

    /**
     * Commit a new state: memory -> chat metadata -> injection -> UI.
     * Returns false (and changes nothing) when the flow belongs to another chat.
     */
    async function commit(next, myEpoch) {
        if (myEpoch !== epoch || chatId() !== boundChatId) return false;
        state = next;
        let saved = false;
        try {
            saved = await st.saveCampaign(state);
        } catch (error) {
            console.error('[HOI] save failed', error);
            toast('Não foi possível salvar a campanha neste chat.', 'error');
        }
        // `false` = refused while SillyTavern reloads this chat: retried on CHAT_CHANGED.
        dirty = saved === false;
        if (myEpoch !== epoch) return false;
        try {
            st.refreshInjection(state);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
        uiSafe((u) => u.refresh());
        return true;
    }

    function loadFromChat() {
        let raw = null;
        try {
            raw = st.loadCampaign(); // also binds StAPI writes to this chat
        } catch (error) {
            console.warn('[HOI] loadCampaign failed', error);
        }
        boundChatId = chatId();
        dirty = false;
        if (!raw) return null;
        const migrated = engine.migrate(raw);
        if (!migrated) {
            toast('Este chat tem uma campanha de uma versão anterior da extensão, que não é compatível. Inicie uma nova campanha.', 'warning');
        }
        return migrated;
    }

    async function safePost(text) {
        try {
            return (await st.postNarrator(text)) !== false;
        } catch (error) {
            console.warn('[HOI] postNarrator failed', error);
            return false;
        }
    }

    /* ----------------------------------------------------------- outcome */

    async function maybeShowOutcome() {
        if (!state || !state.outcome) return;
        const key = `${state.campaignId}:${state.outcome.turn}`;
        if (shownOutcome === key) return;
        shownOutcome = key;
        const nation = playerNation(state);
        if (settings().postBulletins) {
            const verdict = state.outcome.kind === 'victory' ? 'VITÓRIA' : 'DERROTA';
            const tail = nation ? `\n\nFim do governo de ${state.player.title} ${state.player.leaderName} (${nation.name}).` : '';
            await safePost(`**${verdict} — ${formatDate(state.date)}**\n\n${state.outcome.reason}${tail}`);
        }
        await uiSafe((u) => u.showGameOver({ kind: state.outcome.kind, reason: state.outcome.reason }));
    }

    /** index.js calls this on GENERATION_ENDED / GENERATION_STOPPED. */
    function afterGeneration() {
        if (!outcomeDeferred) return;
        outcomeDeferred = false;
        void maybeShowOutcome();
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
     * Must be called while holding the busy lock.
     * @returns {Promise<Array<{eventTitle:string, optionLabel:string}>>}
     */
    async function presentDecisions(myEpoch) {
        const decisions = [];
        for (let guard = 0; guard < 12; guard++) {
            if (myEpoch !== epoch || !state || isOver()) break;
            const ev = state.pendingEvent || (state.eventQueue && state.eventQueue[0]);
            if (!ev) break;
            const choice = await uiSafe((u) => u.showEvent(ev, { dismissible: true }));
            if (myEpoch !== epoch || typeof choice !== 'number') break;
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
        busyOwner = null;
        state = loadFromChat();
        try {
            st.refreshInjection(state);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
        if (!started) {
            started = true;
            await uiSafe((u) => u.mount());
            // Warm the scenario cache in the background (the wizard opens instantly later).
            scenario.load().catch((error) => console.warn('[HOI] scenario preload failed', error));
        }
        uiSafe((u) => u.refresh());
    }

    async function onChatChanged() {
        const id = chatId();
        if (id && id === boundChatId && state) {
            // Same chat reloaded (persona switch, reloadCurrentChat, branch UI...): keep the
            // live campaign and the flows that are running, and re-save if a write was
            // refused while the chat was being reloaded.
            let stored = null;
            try {
                stored = st.loadCampaign(); // re-binds to the reloaded metadata
            } catch {
                stored = null;
            }
            const storedId = stored && typeof stored === 'object' ? stored.campaignId : null;
            if (!storedId || storedId === state.campaignId) {
                if (dirty || !storedId || stored.turn !== state.turn) {
                    dirty = (await st.saveCampaign(state)) === false;
                }
                try {
                    st.refreshInjection(state);
                } catch { /* ignore */ }
                uiSafe((u) => u.refresh());
                return;
            }
        }
        epoch += 1;
        busyOwner = null; // revoke: a stale flow can no longer release (or reuse) the lock
        outcomeDeferred = false;
        closeDialogs();
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
        if (busyOwner) {
            toast(BUSY_MSG, 'warning');
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
        if (!chatId()) {
            toast('Abra um chat antes de iniciar a campanha: cada chat guarda uma campanha.', 'warning');
            return;
        }

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
        if (hasDecisions()) await openPendingEvent();
    }

    /* ------------------------------------------------------------ actions */

    /** Danger dialog for `confirm: true` actions. */
    async function confirmAction(def, targetId) {
        const target = targetId && state && state.nations[targetId] ? ` contra ${state.nations[targetId].name}` : '';
        const ok = await uiSafe((u) => u.confirm({
            title: `${def.name}${target}`,
            text: `${def.description} Esta decisão pode ter consequências graves e irreversíveis.`,
            okLabel: 'Executar',
        }));
        return ok === true;
    }

    function notExecuted(def, actionId, targetId, summary, reason) {
        return { ok: false, success: false, actionId, targetId: targetId || null, summary, details: [], reasons: [reason] };
    }

    /**
     * Execute a catalog action for the player.
     * @param {'ui'|'command'|'order'} source  'ui' callers (War Room) already confirmed.
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
        if (busyOwner) {
            toast(BUSY_MSG, 'warning');
            return null;
        }
        const myEpoch = epoch;
        const def = actionDef(actionId);
        if (def && def.confirm && source !== 'ui') {
            const ok = await confirmAction(def, targetId);
            if (myEpoch !== epoch) return null;
            if (!ok) {
                const result = notExecuted(def, actionId, targetId, `${def.name}: cancelada.`, 'Cancelada pelo governante.');
                if (source === 'command') uiSafe((u) => u.showActionResult(result));
                return result;
            }
        }
        const token = acquire('', { overlay: false });
        if (!token) {
            toast(BUSY_MSG, 'warning');
            return null;
        }
        let result;
        try {
            const out = engine.executeAction(state, state.player.nationId, actionId, targetId || null, { source });
            result = out.result;
            if (result.ok && !(await commit(out.state, myEpoch))) return result;
        } finally {
            release(token);
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
     * @param {'chat'|'warroom'|'command'} source  'chat' runs inside the generate interceptor.
     * @returns {Promise<import('../contract/events.js').ActionResult[]>}
     */
    async function handleOrder(text, source = 'warroom') {
        const message = String(text || '').trim();
        if (!message) return [];
        const fromChat = source === 'chat';
        if (!hasCampaign() || isOver()) {
            if (!fromChat) toast('Nenhuma campanha ativa neste chat.', 'warning');
            return [];
        }
        if (busyOwner) {
            toast(fromChat ? 'Ordens desta mensagem ignoradas: o turno ainda estava sendo processado.' : BUSY_MSG, 'warning');
            return [];
        }
        const myEpoch = epoch;
        // Chat orders: the user's reply is already waiting, so no busy overlay.
        const results = await withBusy(BUSY_LABELS.orders, async () => {
            const { orders, error } = await llm.interpretOrders(state, message);
            if (myEpoch !== epoch) return [];
            if (!orders.length) {
                if (error) toast(error, 'warning');
                else if (!fromChat) toast('O gabinete não identificou nenhuma ordem executável nesse texto.', 'info');
                return [];
            }
            const out = [];
            let next = state;
            for (const order of orders) {
                const def = actionDef(order.actionId);
                if (def && def.confirm) {
                    if (fromChat) {
                        out.push(notExecuted(def, order.actionId, order.targetId,
                            `${def.name}: não executada. Ações irreversíveis exigem confirmação na Sala de Guerra.`,
                            'Ordens do chat não executam ações irreversíveis.'));
                        continue;
                    }
                    const ok = await confirmAction(def, order.targetId);
                    if (myEpoch !== epoch) return [];
                    if (!ok) {
                        out.push(notExecuted(def, order.actionId, order.targetId, `${def.name}: cancelada.`, 'Cancelada pelo governante.'));
                        continue;
                    }
                }
                const res = engine.executeAction(next, next.player.nationId, order.actionId, order.targetId, { source: 'order' });
                out.push(res.result);
                if (res.result.ok) next = res.state;
                if (next.phase === PHASES.GAME_OVER) break;
            }
            if (next !== state && !(await commit(next, myEpoch))) return [];
            for (const r of out) uiSafe((u) => u.showActionResult(r));
            return out;
        }, { overlay: !fromChat });
        if (isOver()) {
            if (fromChat) outcomeDeferred = true; // shown after the reply is generated
            else await maybeShowOutcome();
        }
        return results || [];
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
        if (busyOwner) {
            toast(BUSY_MSG, 'warning');
            return;
        }
        if (hasDecisions()) {
            toast('Há decisões pendentes. Resolva-as antes de avançar o mês.', 'warning');
            await openPendingEvent();
            return;
        }
        const myEpoch = epoch;
        let report = null;
        await withBusy(BUSY_LABELS.turn, async (token) => {
            const out = engine.endTurn(state);
            if (!(await commit(out.state, myEpoch))) return;
            report = out.report;
            uiSafe((u) => u.showTurnReport(report));
            if (isOver()) return;

            relabel(token, BUSY_LABELS.event);
            let recentChat = '';
            try {
                recentChat = st.recentChatText(8);
            } catch {
                recentChat = '';
            }
            const event = await llm.generateTurnEvent(state, { report, recentChat });
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
                if (myEpoch !== epoch || chatId() !== boundChatId) return;
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
        if (!hasDecisions()) {
            toast('Nenhuma decisão pendente.', 'info');
            return;
        }
        if (busyOwner) {
            toast(BUSY_MSG, 'warning');
            return;
        }
        await lockedDecisions(epoch);
        await maybeShowOutcome();
    }

    /** presentDecisions while holding the lock (no overlay: the dialog itself is modal). */
    async function lockedDecisions(myEpoch) {
        const token = acquire('', { overlay: false });
        if (!token) return [];
        try {
            return await presentDecisions(myEpoch);
        } finally {
            release(token);
        }
    }

    /* -------------------------------------------------------- persistence */

    async function save() {
        if (!hasCampaign()) {
            toast('Nenhuma campanha para salvar neste chat.', 'warning');
            return;
        }
        const ok = await commit(state, epoch);
        if (ok && !dirty) toast('Campanha salva neste chat.', 'success');
        else toast('O SillyTavern está carregando o chat; a campanha será salva assim que terminar.', 'warning');
    }

    /** @param {{confirmed?: boolean}} [opts] confirmed: the caller already asked the player. */
    async function reset(opts = {}) {
        if (!state) {
            toast('Este chat não tem campanha.', 'info');
            return;
        }
        if (busyOwner) {
            toast(BUSY_MSG, 'warning');
            return;
        }
        const myEpoch = epoch;
        if (!opts.confirmed) {
            const ok = await uiSafe((u) => u.confirm({
                title: 'Apagar a campanha deste chat?',
                text: 'O estado do jogo (mapa, recursos, guerras e decisões) será apagado. As mensagens do chat continuam. Não é possível desfazer.',
                okLabel: 'Apagar campanha',
            }));
            if (!ok || myEpoch !== epoch) return;
        }
        let cleared = false;
        try {
            cleared = (await st.clearCampaign()) !== false;
        } catch (error) {
            console.error('[HOI] clearCampaign failed', error);
        }
        if (!cleared) {
            toast('Não foi possível apagar agora: o SillyTavern está carregando o chat. Tente de novo.', 'warning');
            return;
        }
        state = null;
        shownOutcome = null;
        outcomeDeferred = false;
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
        isBusy: () => !!busyOwner,
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
        afterGeneration,
        save,
        reset,
        onChatChanged,
        getState: () => state,
        statusText,
        isBusy: () => !!busyOwner,
        query,
    };
}
