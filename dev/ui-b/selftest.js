/**
 * dev/ui-b/selftest.js — in-browser behaviour checks for the UI-B dialogs
 * (keyboard, focus trap/restore, stacking, dismissal). Loaded by
 * preview.html?selftest=1; results land in window.__selftest and #log.
 */

import { openModal, closeAllModals, openModalCount } from '../../src/ui/dialogs/modalHost.js';
import { openConfirm } from '../../src/ui/dialogs/confirm.js';
import { openEventDialog } from '../../src/ui/dialogs/eventDialog.js';
import { openWizard } from '../../src/ui/dialogs/wizard.js';
import { openGameOver } from '../../src/ui/dialogs/gameOver.js';
import { EVENT_ALL_EFFECTS, EVENT_ENGINE, RANKING, SCENARIO, makeState } from './fixtures.js';

const assetUrl = (p) => new URL(`../../assets/${p}`, import.meta.url).href;
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const key = (k, opts = {}) => {
    const target = document.activeElement || document.body;
    const code = /^[0-9]$/.test(k) ? `Digit${k}` : k;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...opts }));
};
const settle = async (p, ms = 400) => Promise.race([p, wait(ms).then(() => '__pending__')]);
const results = [];
// Closing layers stay in the DOM for the fade-out: query only open ones.
const qa = (sel) => [...document.querySelectorAll('.hoi-modal-layer:not(.is-closing)')].flatMap((l) => [...l.querySelectorAll(sel)]);
const q = (sel) => { const all = qa(sel); return all.length ? all[all.length - 1] : null; };
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

export async function runSelftest() {
    const state = makeState();
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);

    // 1. Event: key "2" resolves index 1.
    opener.focus();
    let p = openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, showArt: true, dismissible: true });
    await wait();
    check('event: focus moved into dialog', document.activeElement && document.activeElement.closest('.hoi-modal'));
    key('2');
    let r = await settle(p);
    check('event: key 2 -> 1', r === 1, r);
    await wait(250);
    check('event: focus restored to opener', document.activeElement === opener, document.activeElement && document.activeElement.textContent);
    check('event: layer removed after fade-out', !document.querySelector('.hoi-modal-layer'), document.querySelectorAll('.hoi-modal-layer').length);

    // 2. Event: Esc -> null; "Decidir depois" -> null.
    p = openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, dismissible: true });
    await wait();
    key('Escape');
    check('event: Esc -> null', (await settle(p)) === null);
    p = openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, dismissible: true });
    await wait();
    q('.hoi-event__later').click();
    check('event: Decidir depois -> null', (await settle(p)) === null);

    // 3. Non-dismissible engine event ignores Esc and backdrop; no "Decidir depois".
    p = openEventDialog({ event: EVENT_ENGINE, state, assetUrl, dismissible: false });
    await wait();
    key('Escape');
    const backdrop = q('.hoi-modal-backdrop');
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    check('engine event: Esc/backdrop ignored', (await settle(p, 200)) === '__pending__');
    check('engine event: no postpone button', !q('.hoi-event__later'));
    check('engine event: key 5 ignored (2 options)', (key('5'), await settle(p, 100)) === '__pending__');
    qa('.hoi-event-option')[1].click();
    check('engine event: click option 2 -> 1', (await settle(p)) === 1);

    // 4. Untrusted text is rendered as text.
    p = openEventDialog({ event: { ...EVENT_ALL_EFFECTS, title: '<img src=x onerror=alert(1)>', narrative: '<b>negrito</b>' }, state, assetUrl });
    await wait();
    check('event: title is text, not HTML', !q('.hoi-event__title img') && q('.hoi-event__title').textContent.includes('<img'));
    check('event: narrative is text', !q('.hoi-event__narrative b'));
    key('Escape');
    await settle(p);

    // 5. Focus trap: Tab from the last focusable wraps to the first.
    p = openConfirm({ title: 'Teste', text: 'Linha 1\nLinha 2', okLabel: 'Sim', cancelLabel: 'Não' });
    await wait();
    const buttons = [...qa('.hoi-confirm__actions button')];
    check('confirm: ok focused by default', document.activeElement === buttons[1]);
    key('Tab');
    check('confirm: Tab wraps to first', document.activeElement === buttons[0], document.activeElement && document.activeElement.textContent);
    key('Tab', { shiftKey: true });
    check('confirm: Shift+Tab wraps to last', document.activeElement === buttons[1]);
    opener.focus(); // focusin guard must pull focus back into the dialog
    await wait();
    check('confirm: focus cannot leave the modal', document.activeElement !== opener && document.activeElement.closest('.hoi-modal'));
    key('Escape');
    check('confirm: Esc -> false', (await settle(p)) === false);
    p = openConfirm({ title: 'Perigo', text: 'x', danger: true });
    await wait();
    check('confirm danger: cancel focused by default', document.activeElement && document.activeElement.textContent === 'Cancelar');
    q('.hoi-confirm__actions .hoi-btn--danger').click();
    check('confirm danger: ok -> true', (await settle(p)) === true);

    // 6. Stacking: Esc closes only the top modal.
    const pe = openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, dismissible: true });
    await wait();
    const pc = openConfirm({ title: 'Em cima', text: 'x' });
    await wait();
    check('stack: two layers', openModalCount() === 2, openModalCount());
    key('Escape');
    check('stack: top confirm -> false', (await settle(pc)) === false);
    check('stack: event still open', (await settle(pe, 100)) === '__pending__' && openModalCount() === 1);
    key('1');
    check('stack: event receives keys again', (await settle(pe)) === 0);

    // 7. Keys never reach SillyTavern's document handlers while a modal is up.
    let leaked = 0;
    const spy = () => { leaked += 1; };
    document.addEventListener('keydown', spy);
    p = openConfirm({ title: 'x', text: 'y' });
    await wait();
    key('ArrowLeft');
    key('Escape');
    await settle(p);
    document.removeEventListener('keydown', spy);
    check('keys do not bubble to document', leaked === 0, leaked);

    // 8. onDismiss is called exactly once; close() does not call it.
    let dismissed = 0;
    const h = openModal({ content: 'x', dismissible: true, onDismiss: () => { dismissed += 1; } });
    await wait();
    key('Escape');
    key('Escape');
    h.close();
    check('modal: onDismiss once', dismissed === 1, dismissed);
    let dismissed2 = 0;
    const h2 = openModal({ content: 'y', onDismiss: () => { dismissed2 += 1; } });
    h2.close();
    h2.close();
    check('modal: close() does not dismiss', dismissed2 === 0);

    // 9. closeAllModals resolves every pending dialog.
    const a = openEventDialog({ event: EVENT_ENGINE, state, assetUrl, dismissible: false });
    const b = openGameOver({ outcome: { kind: 'victory', reason: 'ok' }, state, ranking: RANKING, assetUrl });
    await wait();
    closeAllModals();
    check('closeAllModals: event -> null', (await settle(a)) === null);
    check('closeAllModals: gameOver -> close', (await settle(b)) === 'close');
    check('closeAllModals: none left', openModalCount() === 0);

    // 10. Wizard: Esc cancels; full flow returns the choice.
    p = openWizard({ scenario: SCENARIO, assetUrl, defaultLeaderName: 'Helena Duarte', defaultDifficulty: 'dificil' });
    await wait();
    key('Escape');
    check('wizard: Esc -> null', (await settle(p)) === null);
    p = openWizard({ scenario: SCENARIO, assetUrl, defaultLeaderName: '  Helena   Duarte ', defaultDifficulty: 'dificil' });
    await wait();
    qa('.hoi-wz-bookmark')[2].click();
    q('.hoi-wizard__next').click();
    await wait();
    const search = q('.hoi-wz-search__input');
    search.value = 'taiwan';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    check('wizard: search filters to 1 tile', qa('.hoi-wz-tile').length === 1);
    q('.hoi-wz-tile').click();
    check('wizard: dossier shows period war', q('.hoi-wz-dossier').textContent.includes('Terceira Guerra Mundial'));
    search.focus();
    key('Escape');
    check('wizard: first Esc clears search, keeps wizard', search.value === '' && openModalCount() === 1);
    q('.hoi-wizard__next').click();
    await wait();
    const name = q('.hoi-wz-ruler__input');
    name.value = '   ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    check('wizard: empty name disables submit', q('.hoi-wizard__next').disabled);
    name.value = '  Helena   Duarte ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    check('wizard: summary line', q('.hoi-wz-summary__line').textContent === 'Você será Presidente Helena Duarte de Taiwan em Junho de 2031.',
        q('.hoi-wz-summary__line').textContent);
    q('.hoi-wizard__next').click();
    r = await settle(p);
    check('wizard: result', JSON.stringify(r) === JSON.stringify({ bookmarkId: 'b2031', nationId: 'TWN', leaderName: 'Helena Duarte', difficulty: 'dificil' }), JSON.stringify(r));

    // 11. Game over buttons.
    p = openGameOver({ outcome: { kind: 'defeat', reason: 'Golpe.' }, state, ranking: RANKING, assetUrl });
    await wait();
    check('gameOver: Nova Campanha focused', document.activeElement && document.activeElement.textContent.includes('Nova Campanha'));
    document.activeElement.click();
    check('gameOver: new', (await settle(p)) === 'new');

    opener.remove();
    const failed = results.filter((x) => !x.ok);
    window.__selftest = { passed: results.length - failed.length, failed, total: results.length };
    const log = document.getElementById('log');
    if (log) log.textContent = JSON.stringify(window.__selftest, null, 1);
    return window.__selftest;
}
