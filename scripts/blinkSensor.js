// Junta medição dos olhos (pixels), bloqueio por movimento e detector de piscada.
import { BlinkDetector } from './blink.js';
import { measureEyes, faceAnchor, faceMotion } from './eyes.js';

export class BlinkSensor {
    /**
     * @param maxMotion movimento máximo do rosto por frame (fração da distância entre os olhos).
     *                  Numa piscada real o rosto se move < 3%; chacoalhar a câmera passa disso
     *                  e borra a imagem, o que imitaria um olho fechado.
     */
    constructor({ maxMotion = 0.04, settleFrames = 2, ...detectorOpts } = {}) {
        this.detector = new BlinkDetector(detectorOpts);
        this.maxMotion = maxMotion;
        this.settleFrames = settleFrames;
        this.prev = null;
        this.settle = 0;
    }

    get count() { return this.detector.count; }
    set count(v) { this.detector.count = v; }

    /** Processa um frame. Retorna { blinked, moving, motion, sample }. */
    process(source, landmarks, now = performance.now()) {
        const anchor = faceAnchor(landmarks);
        const motion = faceMotion(this.prev, anchor);
        this.prev = anchor;
        if (motion > this.maxMotion) {
            // Em movimento: descarta piscada em andamento e espera estabilizar.
            this.detector.interrupt();
            this.settle = this.settleFrames;
            return { blinked: false, moving: true, motion };
        }
        if (this.settle > 0) {
            this.settle--;
            return { blinked: false, moving: true, motion };
        }
        const sample = measureEyes(source, landmarks);
        if (!sample) return { blinked: false, moving: false, motion };
        return { blinked: this.detector.update(sample, now), moving: false, motion, sample };
    }

    /** Rosto não encontrado neste frame. */
    lost() {
        this.detector.interrupt();
        this.prev = null;
    }
}
