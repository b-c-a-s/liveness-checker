// Detector de piscada por queda relativa de um sinal de "abertura do olho".
//
// O sinal vem de scripts/eyes.js (pixels da região do olho). O detector é agnóstico:
//  - linha de base = percentil 75 dos frames recentes (robusto a outliers e a quem pisca muito);
//  - ruído = desvio robusto (MAD) dos frames de olho aberto; a queda precisa superá-lo;
//  - os DOIS olhos precisam cair (piscada é bilateral; reflexo num olho só não conta);
//  - histerese: entra em "fechado" abaixo do limiar e só sai acima do meio do caminho de
//    volta à base, evitando contar duas piscadas numa oscilação;
//  - olho "fechado" por mais de maxBlinkMs não é piscada (sorriso, cabeça inclinada...).

export function eyeAspectRatio(eye) {
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
}

function quantile(arr, q) {
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

class Track {
    constructor(window) { this.window = window; this.values = []; this.base = 0; this.noise = 0; }
    push(v) {
        this.values.push(v);
        if (this.values.length > this.window) this.values.shift();
        this.base = quantile(this.values, 0.75);
        // Ruído medido só na metade superior (olho aberto), em torno da base.
        const med = quantile(this.values, 0.5);
        const upper = this.values.filter((x) => x >= med);
        this.noise = 1.4826 * quantile(upper.map((x) => Math.abs(x - this.base)), 0.5);
    }
}

export class BlinkDetector {
    /**
     * @param dropRatio  olho fechado quando o sinal < base * dropRatio (queda mínima exigida)
     * @param minFrames  frames seguidos fechado para contar a piscada
     * @param noiseK     a queda também precisa superar noiseK desvios do ruído medido
     * @param maxBlinkMs olho fechado por mais tempo que isso não conta como piscada
     */
    constructor({ dropRatio = 0.75, minFrames = 1, noiseK = 3, window = 60, calibrationFrames = 10, maxBlinkMs = 600 } = {}) {
        Object.assign(this, { dropRatio, minFrames, noiseK, window, calibrationFrames, maxBlinkMs });
        this.reset();
    }

    reset() {
        this.mean = new Track(this.window);
        this.left = new Track(this.window);
        this.right = new Track(this.window);
        this.closed = false;
        this.closedFrames = 0;
        this.closedSince = 0;
        this.count = 0;
    }

    get calibrated() { return this.mean.values.length >= this.calibrationFrames; }
    get baseline() { return this.mean.base; }
    get noise() { return this.mean.noise; }
    get threshold() { return this.#threshold(this.mean); }

    #threshold(t) {
        return t.base - Math.max(t.base * (1 - this.dropRatio), this.noiseK * t.noise);
    }

    /**
     * @param sample número (sinal médio) ou { value, left, right }
     * @param now    instante em ms
     * @returns true quando uma piscada termina
     */
    update(sample, now = performance.now()) {
        const s = typeof sample === 'number' ? { value: sample, left: sample, right: sample } : sample;
        if (!this.calibrated) {
            this.mean.push(s.value); this.left.push(s.left); this.right.push(s.right);
            return false;
        }
        // Limiares com o histórico ANTERIOR a este frame.
        const thr = this.#threshold(this.mean);
        const reopen = (thr + this.mean.base) / 2;
        // Cada olho precisa ter caído ao menos metade da queda exigida do sinal médio.
        const eyeDrop = (1 - thr / this.mean.base) / 2;
        const bothDown = s.left < this.left.base * (1 - eyeDrop) && s.right < this.right.base * (1 - eyeDrop);
        this.mean.push(s.value); this.left.push(s.left); this.right.push(s.right);

        if (!this.closed) {
            if (s.value < thr && bothDown) {
                this.closed = true;
                this.closedFrames = 1;
                this.closedSince = now;
            }
            return false;
        }
        if (s.value < reopen) {
            this.closedFrames++;
            return false;
        }
        const blinked = this.closedFrames >= this.minFrames && now - this.closedSince <= this.maxBlinkMs;
        this.closed = false;
        this.closedFrames = 0;
        if (blinked) this.count++;
        return blinked;
    }

    // Rosto perdido ou em movimento no meio da piscada: descarta a piscada em andamento.
    interrupt() {
        this.closed = false;
        this.closedFrames = 0;
    }
}
