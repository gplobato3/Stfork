import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt } from '../../src/st/index.js';
import { validateActionArgs } from '../../src/st/commands.js';
import { createFakeContext, installFakeSillyTavern, FakeSlashCommand, FakeSlashCommandNamedArgument, FakeSlashCommandArgument, FakeSlashCommandEnumValue } from './fakeContext.js';
import { makeState, CATALOG } from './worldFixture.js';

function makeController(state = makeState()) {
    const calls = [];
    const record = (name) => async (...args) => {
        calls.push([name, ...args]);
    };
    return {
        calls,
        start: record('start'),
        openWarRoom: record('openWarRoom'),
        newCampaign: record('newCampaign'),
        endTurn: record('endTurn'),
        openPendingEvent: record('openPendingEvent'),
        save: record('save'),
        reset: record('reset'),
        onChatChanged: record('onChatChanged'),
        async doAction(actionId, targetId, source) {
            calls.push(['doAction', actionId, targetId, source]);
            return { ok: true, success: true, actionId, targetId, summary: 'Relações com a Argentina melhoraram (sucesso).', details: ['Relação com Argentina +10'] };
        },
        async handleOrder(text, source) {
            calls.push(['handleOrder', text, source]);
            return [
                { ok: true, success: true, actionId: 'mil_partial_mobilization', targetId: null, summary: 'Mobilização parcial decretada (sucesso).', details: [] },
                { ok: false, success: false, actionId: 'eco_stimulus', targetId: null, summary: 'Estímulo recusado.', details: [], reasons: ['Em recarga'] },
            ];
        },
        getState: () => state,
        statusText: () => 'STATUS-SITREP',
        isBusy: () => false,
    };
}

function setup(state) {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    const st = createSt({ getState: () => state, buildSitrep: () => 'SITREP', getCatalog: () => CATALOG });
    const controller = makeController(state);
    st.registerCommands(controller);
    const cmd = (name) => ctx.SlashCommandParser.commands[name];
    // ST: SlashCommandClosure.js:438 callback(args, value ?? '')
    const exec = (name, named = {}, unnamed = '') => cmd(name).callback({ _scope: null, _parserFlags: {}, _abortController: null, _hasUnnamedArgument: !!unnamed, ...named }, unnamed);
    return { ctx, st, controller, cmd, exec, uninstall };
}

test('registers every DESIGN §5 command with pt-BR help and English aliases', () => {
    const { ctx, cmd, uninstall } = setup(makeState());
    try {
        const names = ctx.calls.commands.map((c) => c.name);
        assert.deepEqual(names, ['hoi', 'hoi-novojogo', 'hoi-turno', 'hoi-ordem', 'hoi-acao', 'hoi-status', 'hoi-decisao', 'hoi-salvar', 'hoi-apagar']);
        const aliases = {
            'hoi-novojogo': 'hoi-newgame',
            'hoi-turno': 'hoi-endturn',
            'hoi-ordem': 'hoi-order',
            'hoi-acao': 'hoi-action',
            'hoi-status': 'hoi-sitrep',
            'hoi-decisao': 'hoi-decision',
            'hoi-salvar': 'hoi-save',
            'hoi-apagar': 'hoi-reset',
        };
        for (const [name, alias] of Object.entries(aliases)) {
            assert.ok(cmd(name).aliases.includes(alias), `${name} -> ${alias}`);
            assert.equal(cmd(alias), cmd(name));
        }
        for (const c of ctx.calls.commands) {
            assert.ok(c instanceof FakeSlashCommand, 'built with SlashCommand.fromProps');
            assert.equal(typeof c.callback, 'function');
            assert.ok(c.helpString && /[ãçéíóúâê]|campanha|ação|Abre/.test(c.helpString), `pt-BR help for ${c.name}`);
        }
    } finally {
        uninstall();
    }
});

test('argument shapes: /hoi-acao named acao (required) + alvo; /hoi-ordem unnamed text (required)', () => {
    const { cmd, uninstall } = setup(makeState());
    try {
        const acao = cmd('hoi-acao');
        assert.equal(acao.namedArgumentList.length, 2);
        const [a, b] = acao.namedArgumentList;
        assert.ok(a instanceof FakeSlashCommandNamedArgument);
        assert.equal(a.name, 'acao');
        assert.equal(a.isRequired, true);
        assert.deepEqual(a.typeList, ['string']);
        assert.equal(b.name, 'alvo');
        assert.equal(b.isRequired, false);
        assert.equal(a.forceEnum, false);
        const enumValues = a.enumProvider();
        assert.ok(enumValues[0] instanceof FakeSlashCommandEnumValue);
        assert.deepEqual(enumValues.map((v) => v.value), CATALOG.map((c) => c.id));
        const targets = b.enumProvider().map((v) => v.value);
        assert.ok(targets.includes('ARG'));
        assert.ok(!targets.includes('BRA'), 'player excluded');
        assert.ok(!targets.includes('XAN'), 'annexed excluded');

        const ordem = cmd('hoi-ordem');
        assert.equal(ordem.unnamedArgumentList.length, 1);
        assert.ok(ordem.unnamedArgumentList[0] instanceof FakeSlashCommandArgument);
        assert.equal(ordem.unnamedArgumentList[0].isRequired, true);
        assert.equal(typeof ordem.returns, 'string');
        assert.equal(typeof cmd('hoi-status').returns, 'string');
    } finally {
        uninstall();
    }
});

test('/hoi-status returns the sitrep string (pipeable)', async () => {
    const { exec, uninstall } = setup(makeState());
    try {
        assert.equal(await exec('hoi-status'), 'STATUS-SITREP');
    } finally {
        uninstall();
    }
});

test('/hoi-acao validates and returns the result summary', async () => {
    const { exec, controller, uninstall } = setup(makeState());
    try {
        const out = await exec('hoi-acao', { acao: 'dip_improve_relations', alvo: 'arg' });
        assert.equal(out, 'Relações com a Argentina melhoraram (sucesso). (Relação com Argentina +10)');
        assert.deepEqual(controller.calls.at(-1), ['doAction', 'dip_improve_relations', 'ARG', 'command']);

        assert.match(await exec('hoi-acao', { acao: 'nao_existe' }), /desconhecida/);
        assert.match(await exec('hoi-acao', { acao: 'dip_improve_relations' }), /exige um alvo/);
        assert.match(await exec('hoi-acao', { acao: 'dip_improve_relations', alvo: 'ZZZ' }), /Nação desconhecida/);
        assert.match(await exec('hoi-acao', { acao: 'dip_improve_relations', alvo: 'BRA' }), /própria nação/);
        assert.match(await exec('hoi-acao', {}), /Informe a ação/);
        assert.equal(controller.calls.filter((c) => c[0] === 'doAction').length, 1);

        await exec('hoi-acao', { acao: 'mil_partial_mobilization', alvo: 'ARG' });
        assert.deepEqual(controller.calls.at(-1), ['doAction', 'mil_partial_mobilization', null, 'command'], 'untargeted action ignores alvo');
    } finally {
        uninstall();
    }
});

test('/hoi-ordem passes the text to controller.handleOrder and lists results', async () => {
    const { exec, controller, uninstall } = setup(makeState());
    try {
        const out = await exec('hoi-ordem', {}, 'Mobilizem as reservas e estimulem a economia');
        assert.deepEqual(controller.calls.at(-1), ['handleOrder', 'Mobilizem as reservas e estimulem a economia', 'command']);
        assert.equal(out, 'Mobilização parcial decretada (sucesso).\nEstímulo recusado. Motivo: Em recarga.');
        assert.match(await exec('hoi-ordem', {}, ''), /Escreva a ordem/);
    } finally {
        uninstall();
    }
});

test('simple commands call the controller; no campaign gives a pt-BR hint', async () => {
    const { exec, controller, uninstall } = setup(makeState({ pendingEvent: { title: 'X' } }));
    try {
        for (const [name, method] of [['hoi', 'openWarRoom'], ['hoi-novojogo', 'newCampaign'], ['hoi-turno', 'endTurn'], ['hoi-decisao', 'openPendingEvent'], ['hoi-salvar', 'save'], ['hoi-apagar', 'reset']]) {
            await exec(name);
            assert.equal(controller.calls.at(-1)[0], method, name);
        }
    } finally {
        uninstall();
    }
    const s2 = setup(null);
    try {
        assert.match(await s2.exec('hoi-status'), /Nenhuma campanha/);
        assert.match(await s2.exec('hoi-turno'), /Nenhuma campanha/);
        await s2.exec('hoi-novojogo');
        assert.equal(s2.controller.calls.at(-1)[0], 'newCampaign');
    } finally {
        s2.uninstall();
    }
});

test('a throwing controller becomes a toast, never an exception into ST', async () => {
    const { exec, controller, uninstall } = setup(makeState());
    const toasts = [];
    globalThis.toastr = { error: (m) => toasts.push(m), info() {}, success() {}, warning() {} };
    try {
        controller.endTurn = async () => {
            throw new Error('ocupado');
        };
        assert.equal(await exec('hoi-turno'), '');
        assert.match(toasts[0], /ocupado/);
    } finally {
        delete globalThis.toastr;
        uninstall();
    }
});

test('registerCommands is idempotent', () => {
    const { ctx, st, controller, uninstall } = setup(makeState());
    try {
        st.registerCommands(controller);
        assert.equal(ctx.calls.commands.length, 9);
    } finally {
        uninstall();
    }
});

test('validateActionArgs without a catalog still checks formats and the roster', () => {
    const state = makeState();
    assert.deepEqual(validateActionArgs({ acao: 'Dip_X', alvo: 'arg' }, { state, catalog: null }), { ok: true, actionId: 'dip_x', targetId: 'ARG' });
    assert.equal(validateActionArgs({ acao: 'drop table' }, { state, catalog: null }).ok, false);
});
