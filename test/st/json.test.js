import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJsonLoose, stripReasoning, isEmptyObject } from '../../src/st/json.js';

const ok = (input) => {
    const r = parseJsonLoose(input);
    assert.equal(r.ok, true, `expected ok for ${JSON.stringify(input).slice(0, 80)}`);
    return r.value;
};

test('plain JSON string', () => {
    assert.deepEqual(ok('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] });
});

test('already-parsed object (ConnectionManager + json_schema) is returned as-is', () => {
    const obj = { orders: [] };
    assert.equal(ok(obj), obj);
});

test('fenced ```json block with prose around it', () => {
    const text = 'Claro! Aqui está o evento:\n```json\n{"title":"Crise","options":[]}\n```\nEspero que ajude.';
    assert.deepEqual(ok(text), { title: 'Crise', options: [] });
});

test('leading prose without fences', () => {
    assert.deepEqual(ok('Here is the JSON you asked for: {"orders":[{"actionId":"x"}]} — done'), { orders: [{ actionId: 'x' }] });
});

test('reasoning blocks are removed, including braces inside them', () => {
    const text = '<think>The user wants {"fake": true}. Let me think... {not json}</think>\n{"real":true}';
    assert.deepEqual(ok(text), { real: true });
    assert.deepEqual(ok('<thinking>plan</thinking>```\n{"x":2}\n```'), { x: 2 });
});

test('unterminated reasoning tag keeps the JSON after it', () => {
    assert.deepEqual(ok('<think>long reasoning that never closes {"real":1}'), { real: 1 });
});

test('stray closing tag (opening tag in the prefill)', () => {
    assert.deepEqual(ok('reasoning text here</think>{"k":"v"}'), { k: 'v' });
});

test('trailing commas and smart quotes are repaired', () => {
    assert.deepEqual(ok('{"a": [1, 2,], "b": {"c": 3,},}'), { a: [1, 2], b: { c: 3 } });
    assert.deepEqual(ok('{\u201Ca\u201D: 1}'), { a: 1 });
});

test('braces inside strings do not break balancing', () => {
    assert.deepEqual(ok('prefix {"t":"usa {chaves} aqui","n":1} suffix'), { t: 'usa {chaves} aqui', n: 1 });
});

test('unterminated fence (cut by max tokens) still parses a complete object', () => {
    assert.deepEqual(ok('```json\n{"a":1}'), { a: 1 });
});

test('failures', () => {
    assert.equal(parseJsonLoose('').ok, false);
    assert.equal(parseJsonLoose(null).ok, false);
    assert.equal(parseJsonLoose('no json here').ok, false);
    assert.equal(parseJsonLoose('{"broken": ').ok, false);
});

test('helpers', () => {
    assert.equal(stripReasoning('<reasoning>x</reasoning>y'), 'y');
    assert.equal(isEmptyObject({}), true);
    assert.equal(isEmptyObject({ a: 1 }), false);
    assert.equal(isEmptyObject([]), false);
});
