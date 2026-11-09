import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlinkDetector } from '../scripts/blink.js';

// Valores típicos do sinal de abertura do olho (scripts/eyes.js), medidos em vídeo real:
// aberto ~0.40, fechado ~0.24 (queda ~40%), ruído de ~3% com câmera parada.
const OPEN = 0.40, CLOSED = 0.24;

// Gerador pseudo-aleatório determinístico, para o ruído ser reprodutível.
function rng(seed = 42) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Sequência de amostras { value, left, right }: olho aberto com ruído e piscadas nos frames indicados.
function sequence({ open = OPEN, closed = CLOSED, frames, blinksAt = [], blinkLen = 2, noise = 0.012, seed, oneEye = false }) {
    const rand = rng(seed);
    const out = [];
    for (let i = 0; i < frames; i++) {
        const inBlink = blinksAt.some((b) => i >= b && i < b + blinkLen);
        const l = (inBlink ? closed : open) + (rand() * 2 - 1) * noise;
        const r = (inBlink && !oneEye ? closed : open) + (rand() * 2 - 1) * noise;
        out.push({ value: (l + r) / 2, left: l, right: r });
    }
    return out;
}

// Relógio simulado (padrão ~30 fps).
function clocked(opts, fps = 30) {
    const d = new BlinkDetector(opts);
    let i = 0;
    const update = d.update.bind(d);
    d.update = (s) => update(s, (i++ * 1000) / fps);
    return d;
}

const run = (seq, opts, fps) => {
    const d = clocked(opts, fps);
    seq.forEach((s) => d.update(s));
    return d.count;
};

test('detecta uma piscada típica', () => {
    for (let seed = 1; seed <= 20; seed++) {
        assert.equal(run(sequence({ frames: 40, blinksAt: [25], seed })), 1, `seed ${seed}`);
    }
});

test('detecta piscada pega em um único frame, parcialmente fechada (queda de 30%)', () => {
    for (let seed = 1; seed <= 20; seed++) {
        assert.equal(run(sequence({ frames: 40, blinksAt: [25], blinkLen: 1, closed: 0.28, seed })), 1, `seed ${seed}`);
    }
});

test('funciona com sinal de baixo contraste (ex.: pele e íris escuras)', () => {
    assert.equal(run(sequence({ open: 0.12, closed: 0.075, frames: 40, blinksAt: [25], noise: 0.003 })), 1);
});

test('funciona em câmera/PC lento (5 fps)', () => {
    assert.equal(run(sequence({ frames: 30, blinksAt: [20], blinkLen: 1 }), {}, 5), 1);
});

test('conta várias piscadas, inclusive de quem pisca muito seguido', () => {
    const blinksAt = [15, 25, 35, 45, 60, 75, 90];
    assert.equal(run(sequence({ frames: 110, blinksAt })), blinksAt.length);
});

test('só um olho "fechando" (reflexo, mão, cabelo) não conta', () => {
    assert.equal(run(sequence({ frames: 60, blinksAt: [25, 40], oneEye: true })), 0);
});

test('oscilação em torno do limiar não conta como duas piscadas (histerese)', () => {
    const d = clocked();
    const s = (v) => ({ value: v, left: v, right: v });
    for (let i = 0; i < 15; i++) d.update(s(0.40));
    [0.28, 0.33, 0.28, 0.32, 0.40].forEach((v) => d.update(s(v)));
    assert.equal(d.count, 1);
});

test('sem piscada não há falso positivo com ruído normal', () => {
    for (let seed = 1; seed <= 30; seed++) {
        assert.equal(run(sequence({ frames: 900, seed })), 0, `seed ${seed}`);
    }
});

test('ruído alto (±10%) eleva o limiar: < 0,1 falso positivo a cada 30 s', () => {
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) total += run(sequence({ frames: 900, noise: 0.04, seed }));
    assert.ok(total / 100 < 0.1, `média ${total / 100}`);
});

test('mudança gradual (aproximar, luz mudando) não conta como piscada', () => {
    const d = clocked();
    for (let i = 0; i < 300; i++) { const v = 0.42 - i * 0.0005; d.update({ value: v, left: v, right: v }); }
    assert.equal(d.count, 0);
});

test('olho "fechado" por muito tempo (sorriso, olhar para baixo) não conta e recalibra', () => {
    const d = clocked();
    const s = (v) => ({ value: v, left: v, right: v });
    for (let i = 0; i < 20; i++) d.update(s(0.40));
    for (let i = 0; i < 90; i++) d.update(s(0.26)); // novo patamar por 3 s
    assert.equal(d.count, 0);
    assert.equal(d.closed, false);
    for (let i = 0; i < 2; i++) d.update(s(0.15)); // piscada a partir do novo patamar
    d.update(s(0.26));
    assert.equal(d.count, 1);
});

test('interrupção (rosto perdido ou em movimento) no meio da piscada não conta', () => {
    const d = clocked();
    const s = (v) => ({ value: v, left: v, right: v });
    for (let i = 0; i < 15; i++) d.update(s(0.40));
    d.update(s(0.22));
    d.interrupt();
    d.update(s(0.40));
    assert.equal(d.count, 0);
});

test('minFrames exige olho fechado por N frames seguidos', () => {
    assert.equal(run(sequence({ frames: 40, blinksAt: [25], blinkLen: 1, noise: 0 }), { minFrames: 2 }), 0);
    assert.equal(run(sequence({ frames: 40, blinksAt: [25], blinkLen: 2, noise: 0 }), { minFrames: 2 }), 1);
});
