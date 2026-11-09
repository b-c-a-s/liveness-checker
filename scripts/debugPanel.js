// Painel de diagnóstico da piscada (ativado em Configurações > "Mostrar sinal do olho na tela").
// Mostra o que o algoritmo vê: recortes dos olhos, gráfico do sinal x limiar, e permite
// copiar os dados brutos para análise.
import { eyeRegion } from './eyes.js';

const MAX = 600; // ~20 s a 30 fps
const VIEW = 150; // amostras visíveis no gráfico

export class DebugPanel {
    constructor(root) {
        this.root = root;
        this.chart = root.querySelector('#debug-chart');
        this.eyes = root.querySelector('#debug-eyes');
        this.info = root.querySelector('#debug-info');
        this.samples = [];
        this.meta = {};
        this.pending = false;
        root.querySelector('#debug-copy').addEventListener('click', () => this.copy());
    }

    show(meta) {
        this.meta = meta;
        this.samples = [];
        this.root.style.display = 'block';
    }

    push(sample, video, landmarks) {
        this.samples.push(sample);
        if (this.samples.length > MAX) this.samples.shift();
        this.video = video;
        this.landmarks = landmarks;
        if (!this.pending) {
            this.pending = true;
            requestAnimationFrame(() => { this.pending = false; this.render(); });
        }
    }

    render() {
        this.#drawEyes();
        this.#drawChart();
        const s = this.samples.at(-1) || {};
        const v = this.video;
        this.info.textContent = [
            `câmera ${v?.videoWidth}x${v?.videoHeight} · distância entre olhos ${s.iod?.toFixed(0)} px · ${s.fps?.toFixed(0) ?? '?'} fps`,
            `sinal ${s.value?.toFixed(3) ?? '—'} (E ${s.left?.toFixed(3) ?? '—'} / D ${s.right?.toFixed(3) ?? '—'}) · base ${s.base?.toFixed(3)} · limiar ${s.thr?.toFixed(3)}`,
            `movimento ${((s.motion || 0) * 100).toFixed(1)}% ${s.moving ? '(IGNORADO: em movimento)' : ''} · estado ${s.closed ? 'FECHADO' : 'aberto'} · piscadas ${s.count}`,
        ].join('\n');
    }

    #drawEyes() {
        const c = this.eyes, v = this.video, lm = this.landmarks;
        if (!v || !lm) return;
        const ctx = c.getContext('2d');
        const W = c.width, H = c.height, half = W / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        // Mesmo recorte usado pela medição. Imagem espelhada? Não: mostra como a câmera entrega.
        [lm.getRightEye(), lm.getLeftEye()].forEach((eye, k) => {
            const r = eyeRegion(eye);
            ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, k * half + 2, 0, half - 4, H);
            ctx.strokeStyle = 'rgba(59,130,246,.9)';
            ctx.strokeRect(k * half + 2, 0, half - 4, H * r.eyeFrac); // região do olho
            ctx.strokeStyle = 'rgba(234,179,8,.9)';
            ctx.strokeRect(k * half + 2, H * r.skinFrac, half - 4, H * (1 - r.skinFrac) - 1); // pele
        });
    }

    #drawChart() {
        const c = this.chart, ctx = c.getContext('2d');
        const W = c.width, H = c.height;
        ctx.clearRect(0, 0, W, H);
        const data = this.samples.slice(-VIEW);
        if (data.length < 2) return;
        const vals = data.flatMap((s) => [s.value, s.base, s.thr]).filter((x) => Number.isFinite(x) && x > 0);
        if (!vals.length) return;
        let lo = Math.min(...vals), hi = Math.max(...vals);
        const pad = (hi - lo) * 0.1 || 0.01; lo -= pad; hi += pad;
        const X = (i) => (i / (VIEW - 1)) * W;
        const Y = (v) => H - ((v - lo) / (hi - lo)) * H;
        data.forEach((s, i) => {
            if (s.moving) { ctx.fillStyle = 'rgba(249,115,22,.25)'; ctx.fillRect(X(i) - W / VIEW / 2, 0, W / VIEW + 1, H); }
            if (s.blinked) { ctx.fillStyle = 'rgba(34,197,94,.9)'; ctx.fillRect(X(i) - 1.5, 0, 3, H); }
        });
        const line = (key, color, dash = []) => {
            ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
            let started = false;
            data.forEach((s, i) => {
                const v = s[key];
                if (!Number.isFinite(v) || v <= 0) { started = false; return; }
                started ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v));
                started = true;
            });
            ctx.stroke(); ctx.setLineDash([]);
        };
        line('base', '#9ca3af', [4, 4]);
        line('thr', '#ef4444', [6, 3]);
        line('value', '#2563eb');
    }

    async copy() {
        const text = JSON.stringify({
            userAgent: navigator.userAgent,
            camera: this.video && { width: this.video.videoWidth, height: this.video.videoHeight },
            ...this.meta,
            samples: this.samples.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]))),
        });
        const btn = this.root.querySelector('#debug-copy');
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = 'Copiado!';
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            btn.textContent = 'Copiado!';
        }
        setTimeout(() => { btn.textContent = 'Copiar diagnóstico'; }, 2000);
    }
}
