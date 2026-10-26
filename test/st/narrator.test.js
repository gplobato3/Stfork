import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt, SYSTEM_AVATAR } from '../../src/st/index.js';
import { NARRATOR_NAME } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';

function setup() {
    const ctx = createFakeContext();
    ctx.chat.push({ name: 'Gabriel', is_user: true, is_system: false, send_date: 'x', mes: 'oi', extra: {} });
    const uninstall = installFakeSillyTavern(ctx);
    const st = createSt({ getState: () => null, buildSitrep: () => '' });
    return { ctx, st, uninstall };
}

test('postNarrator builds the /sys narrator message (slash-commands.js:6020-6043)', async () => {
    const { ctx, st, uninstall } = setup();
    try {
        await st.postNarrator('  O mundo prende a respiração. {{user}}  ');
        assert.equal(ctx.chat.length, 2);
        const msg = ctx.chat[1];
        assert.equal(msg.name, NARRATOR_NAME);
        assert.equal(msg.is_user, false);
        assert.equal(msg.is_system, false, 'is_system:true would hide it from the prompt (script.js:4496)');
        assert.equal(msg.force_avatar, SYSTEM_AVATAR);
        assert.equal(SYSTEM_AVATAR, 'img/five.png');
        assert.equal(msg.extra.type, 'narrator');
        assert.equal(msg.extra.bias, null);
        assert.equal(typeof msg.extra.gen_id, 'number');
        assert.equal(msg.mes, 'O mundo prende a respiração. {{user}}', 'trimmed, macros not evaluated');
        assert.ok(!Number.isNaN(Date.parse(msg.send_date)), 'ISO timestamp like getMessageTimeStamp()');

        assert.equal(ctx.calls.addOneMessage.length, 1);
        assert.equal(ctx.calls.addOneMessage[0].mes, msg);
        assert.equal(ctx.calls.saveChat, 1);
        assert.deepEqual(ctx.calls.emit.map((e) => [e.event, e.args[0]]), [['message_sent', 1], ['user_message_rendered', 1]]);
        assert.equal(ctx.chatMetadata.tainted, true);
    } finally {
        uninstall();
    }
});

test('postNarrator honours a custom name and ignores empty text', async () => {
    const { ctx, st, uninstall } = setup();
    try {
        await st.postNarrator('Comunicado.', { name: 'Agência de Notícias' });
        assert.equal(ctx.chat[1].name, 'Agência de Notícias');
        await st.postNarrator('   ');
        assert.equal(ctx.chat.length, 2);
    } finally {
        uninstall();
    }
});

test('recentChatText: last n non-system messages as "Nome: texto", without our bulletins', () => {
    const { ctx, st, uninstall } = setup();
    try {
        ctx.chat.push(
            { name: 'Sistema', is_user: false, is_system: true, mes: 'oculto', extra: {} },
            { name: NARRATOR_NAME, is_user: false, is_system: false, mes: 'boletim', extra: { type: 'narrator' } },
            { name: 'Conselho de Guerra', is_user: false, is_system: false, mes: '<b>Senhor</b> Presidente,\n\nas tropas...', extra: {} },
            { name: 'Gabriel', is_user: true, is_system: false, mes: 'x'.repeat(900), extra: {} },
        );
        const text = st.recentChatText(2);
        const lines = text.split('\n');
        assert.equal(lines.length, 2);
        assert.equal(lines[0], 'Conselho de Guerra: Senhor Presidente, as tropas...');
        assert.ok(lines[1].startsWith('Gabriel: xxx'));
        assert.ok(lines[1].length <= 'Gabriel: '.length + 500);
        assert.equal(st.recentChatText(10).split('\n').length, 3);
        assert.equal(st.recentChatText(0), '');
    } finally {
        uninstall();
    }
});

test('personaName: ctx.name1 or "Governante"', () => {
    const { ctx, st, uninstall } = setup();
    try {
        assert.equal(st.personaName(), 'Gabriel');
        ctx.name1 = '';
        assert.equal(st.personaName(), 'Governante');
    } finally {
        uninstall();
    }
    assert.equal(createSt({ getState: () => null, buildSitrep: () => '' }).personaName(), 'Governante');
});
