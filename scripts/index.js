import { loadConfig } from './config.js';
import { loadModels, detectFace, trackFace, warmUp } from './face.js';
import { BlinkSensor } from './blinkSensor.js';
import { DebugPanel } from './debugPanel.js';

const CHECK_SVG = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';

// Checklist visível de cada requisito da verificação, com marcador OK quando concluído.
class Steps {
    constructor(list) {
        this.list = list;
        this.items = {};
    }

    reset(blinksRequired) {
        const defs = [
            ['face', 'Face detected'],
            ['left', 'Turn head to one side'],
            ['right', 'Turn head to the other side'],
            ['straight', 'Look straight at the camera'],
            ['blink', blinksRequired > 1 ? `Blink (0/${blinksRequired})` : 'Blink'],
        ];
        this.list.innerHTML = '';
        this.items = {};
        for (const [key, text] of defs) {
            const li = document.createElement('li');
            li.className = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors';
            li.innerHTML = '<span class="flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0"></span>'
                + '<span class="flex-1"></span><span class="text-xs font-bold px-2 py-0.5 rounded"></span>';
            this.list.appendChild(li);
            this.items[key] = { li, text };
            this.set(key, 'pending');
        }
    }

    set(key, state, text) {
        const item = this.items[key];
        if (!item) return;
        if (text) item.text = text;
        item.state = state;
        const [icon, label, badge] = item.li.children;
        label.textContent = item.text;
        if (state === 'done') {
            item.li.className = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors bg-green-50';
            icon.className = 'flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 bg-green-500 border-green-500 text-white';
            icon.innerHTML = CHECK_SVG;
            label.className = 'flex-1 text-green-800 font-medium';
            badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-green-500 text-white';
            badge.textContent = 'OK';
        } else if (state === 'active') {
            item.li.className = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors bg-blue-50';
            icon.className = 'flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 border-blue-500 animate-pulse';
            icon.innerHTML = '';
            label.className = 'flex-1 text-blue-800 font-medium';
            badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700';
            badge.textContent = 'IN PROGRESS';
        } else {
            item.li.className = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors';
            icon.className = 'flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 border-gray-300';
            icon.innerHTML = '';
            label.className = 'flex-1 text-gray-500';
            badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-500';
            badge.textContent = 'PENDING';
        }
    }

    // Marca a etapa atual como OK e ativa a seguinte.
    advance(doneKey, nextKey) {
        this.set(doneKey, 'done');
        if (nextKey) this.set(nextKey, 'active');
    }
}

class Main {
    constructor() {
        this.steps = new Steps(document.getElementById('steps-list'));
        this.stepsSection = document.getElementById('steps');
        this.debugPanel = new DebugPanel(document.getElementById('debug-panel'));
        this.intro = document.getElementById('intro');
        this.consentForm = document.getElementById('consent-form');
        this.loadingSection = document.getElementById('loading-section');
        this.webcamSection = document.getElementById('webcam-section');
        this.videoElement = document.getElementById('webcam');
        this.stream = null;
        this._parentWillTakeControl = false;
        this.loadModels();

        this.initializeEventListeners();
        this.setupPostMessageListeners();
    }

    async initializeEventListeners() {
        if (this.consentForm) {
            this.consentForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const consentCheckbox = document.getElementById('biometric-consent');
                if (consentCheckbox.checked) {
                    this.requestWebcamAccess();
                }
            });
        }

        // Add try again button listener
        const tryAgainBtn = document.querySelector('.try-again-btn');
        if (tryAgainBtn) {
            tryAgainBtn.addEventListener('click', () => {
                document.getElementById('results-section').style.display = 'none';
                this.requestWebcamAccess();
            });
        }
    }

    setupPostMessageListeners() {
        if(window.opener) {
            window.addEventListener('message', (event) => {
                if(event.data.type === 'confirm-parent-commandeer') {
                    this._nonce = event.data.nonce;
                    this._parentWillTakeControl = true;
                }
            });
            window.opener.postMessage({ type: 'check-parent-commandeer' }, '*');
        }
    }

    async loadModels() {
        try {
            const { detectorInputSize: inputSize, detectorScoreThreshold: scoreThreshold } = loadConfig();
            this.promises = loadModels('./models').then(
                () => warmUp({ inputSize, scoreThreshold }).catch(() => {})
            ).catch(() => {
                console.error('Error loading models');
                this.promises = null;
            });
        } catch (error) {
            console.error('Error loading models');
            this.promises = null;
        }
    }

    displayModelError() {
        if(this._parentWillTakeControl) {
            window.opener.postMessage({ type: 'liveness-check-error', error: 'Error loading models', nonce: this._nonce }, '*');
            return;
        }
        this.intro.style.display = 'none';
        this.consentForm.style.display = 'none';
        this.loadingSection.style.display = 'none';
        document.getElementById('model-error').style.display = 'block';
    }

    async requestWebcamAccess() {
        try {
            if(!this.promises) {
                this.displayModelError();
                return;
            }

            this.intro.style.display = 'none';
            this.consentForm.style.display = 'none';

            this.loadingSection.style.display = 'block';
            await new Promise(resolve => setTimeout(resolve, 200));
            try {
                await this.promises;
            } catch (error) {
                this.displayModelError();
                return;
            }

            // Resolução maior = mais pixels nos olhos para medir a piscada. "ideal" não falha:
            // se a câmera não suportar, o navegador entrega a mais próxima.
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            });
            this.videoElement.onloadedmetadata = () => {
                this.videoElement.play();
                this.startLivenessCheck();
            };
            this.videoElement.srcObject = this.stream;
            this.webcamSection.style.display = 'block';
            this.loadingSection.style.display = 'none';
            
        } catch (error) {
            console.error('Error accessing webcam:', error);
            if(this._parentWillTakeControl) {
                window.opener.postMessage({ type: 'liveness-check-error', error: 'Error accessing webcam', nonce: this._nonce }, '*');
                return;
            }
            alert('Unable to access webcam. Please ensure you have granted permission and your webcam is working properly.');
        }
    }

    async startLivenessCheck() {
        const cfg = loadConfig();
        const label = this.webcamSection.querySelector('p');
        let direction = 'to your left';
        let flipped = false;
        let blinking = false;      // fase de piscada ativa
        let blinkStart = 0;
        const blink = new BlinkSensor({ dropRatio: cfg.blinkDropRatio, minFrames: cfg.blinkMinFrames, maxMotion: cfg.blinkMaxMotion });
        let frames = 0, fpsStart = performance.now(), fps = 0;
        let anchor = null, anchorAge = 0; // rastreamento na fase de piscada
        const steps = this.steps;
        const blinkText = () => (cfg.blinksRequired > 1 ? `Blink (${blink.count}/${cfg.blinksRequired})` : 'Blink');
        steps.reset(cfg.blinksRequired);
        steps.set('face', 'active');
        this.stepsSection.style.display = 'block';
        const processFrame = async () => {
            try {
                const detectOpts = { inputSize: cfg.detectorInputSize, scoreThreshold: cfg.detectorScoreThreshold };
                let detection = null;
                // Na fase de piscada o rosto está parado: reaproveita a caixa do rosto e roda só a
                // rede de landmarks (~2-3x mais frames/s). O detector completo roda de novo a cada
                // 15 frames ou quando o rosto se move.
                if (blinking && anchor && ++anchorAge < 15) {
                    detection = await trackFace(this.videoElement, anchor);
                }
                if (!detection) {
                    detection = await detectFace(this.videoElement, detectOpts);
                    anchor = blinking ? detection : null;
                    anchorAge = 0;
                }

                if (detection) {
                    const lm = detection.landmarks;
                    if (steps.items.face.state !== 'done') steps.advance('face', 'left');
                    if (!blinking) {
                        label.textContent = 'Please look ' + direction;

                        //check if the face is looking to the left or right
                        let leftEye = lm.getLeftEye()[0].x;
                        let rightEye = lm.getRightEye()[0].x;
                        let eyeDistance = Math.abs(rightEye - leftEye);
                        let nose = lm.getNose()[4].x;
                        let lookingLeft = nose < leftEye || Math.abs(leftEye - nose) < eyeDistance * cfg.turnTolerance;
                        let lookingRight = nose > rightEye || Math.abs(rightEye - nose) < eyeDistance * cfg.turnTolerance;
                        let lookingStraight = Math.abs(nose - (leftEye + rightEye) / 2) < eyeDistance * cfg.straightTolerance;
                        if(direction == 'to your left' && lookingLeft) {//looking left
                            direction = 'to your right';
                            steps.advance('left', 'right');
                        } else if(direction == 'to your left' && lookingRight) {//looking left flipped
                            direction = 'to your right';
                            flipped = true;
                            steps.advance('left', 'right');
                        } else if(direction == 'to your right' && !flipped && lookingRight) {//looking right
                            direction = 'straight';
                            steps.advance('right', 'straight');
                        } else if(direction == 'to your right' && flipped && lookingLeft) {//looking right flipped
                            direction = 'straight';
                            steps.advance('right', 'straight');
                        } else if(direction == 'straight' && detection.detection.score > cfg.faceScoreMin && lookingStraight){
                            blinking = true;
                            blinkStart = Date.now();
                            steps.advance('straight', 'blink');
                            if (cfg.showDebug) this.debugPanel.show({ config: cfg });
                        }
                    } else {
                        const r = blink.process(this.videoElement, lm, performance.now());
                        if (r.blinked) steps.set('blink', 'active', blinkText());
                        if (cfg.showDebug) {
                            const det = blink.detector, L = lm.getLeftEye()[0], R = lm.getRightEye()[3];
                            this.debugPanel.push({
                                t: Math.round(performance.now()), value: r.sample?.value, left: r.sample?.left, right: r.sample?.right,
                                base: det.baseline, thr: det.threshold, motion: r.motion, moving: r.moving, closed: det.closed,
                                blinked: r.blinked, count: blink.count, fps, iod: Math.hypot(R.x - L.x, R.y - L.y),
                            }, this.videoElement, lm);
                        }
                        if (++frames % 10 === 0) { fps = 10000 / (performance.now() - fpsStart); fpsStart = performance.now(); }
                        const det = blink.detector;
                        label.textContent = (r.moving ? 'Hold still, then blink' : 'Please blink')
                            + (cfg.blinksRequired > 1 ? ` (${blink.count}/${cfg.blinksRequired})` : '')
                            + (cfg.showDebug ? ` — olho ${r.sample ? r.sample.value.toFixed(3) : '—'} · base ${det.baseline.toFixed(3)} · limiar ${det.threshold.toFixed(3)} · mov ${(r.motion * 100).toFixed(1)}% · ${fps.toFixed(0)} fps` : '');
                        if (blink.count >= cfg.blinksRequired) {
                            steps.set('blink', 'done', blinkText());
                            if(this._parentWillTakeControl) {
                                this.sendLivenessToParent();
                                return;
                            }
                            // Pequena pausa para o último OK ficar visível antes do resultado.
                            setTimeout(() => this.displayLiveness(), 700);
                            return;
                        }
                        if (Date.now() - blinkStart > cfg.blinkTimeoutMs) {
                            blink.count = 0;
                            blink.detector.interrupt();
                            blinkStart = Date.now();
                            steps.set('blink', 'active', blinkText());
                        }
                    }
                } else {
                    blink.lost();
                    label.textContent = 'No face detected. Please position your face in the camera view.';
                }
            } catch (error) {
                console.error('Error processing frame:', error);
            }

            // Na fase de piscada processa o próximo frame de vídeo sem espera: uma piscada
            // dura ~150 ms e precisa cair em pelo menos um frame.
            if (blinking && this.videoElement.requestVideoFrameCallback) {
                this.videoElement.requestVideoFrameCallback(() => processFrame());
            } else {
                setTimeout(() => processFrame(), blinking ? 0 : cfg.frameIntervalMs);
            }
        };

        // Start processing frames
        processFrame();
    }

    sendLivenessToParent() {
        const checkmarkOverlay = document.getElementById('checkmark-overlay');
        checkmarkOverlay.classList.remove('hidden');
        
        setTimeout(() => {
            this.stopWebcam();
            window.opener.postMessage({ type: 'liveness-check-result', nonce: this._nonce }, '*');
        }, 1000);
    }

    displayLiveness() {
        this.webcamSection.style.display = 'none';
        const resultsSection = document.getElementById('results-section');
        resultsSection.style.display = 'block';
    }

    stopWebcam() {
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    }
}

let main = new Main();
export default main;
