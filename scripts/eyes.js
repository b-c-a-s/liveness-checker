// Abertura do olho medida pelos PIXELS da região do olho.
//
// A rede de 68 landmarks do face-api localiza bem o olho, mas quase não acompanha a
// pálpebra: com o olho totalmente fechado o EAR cai só ~12% (medido em vídeo real).
// Já os pixels mudam muito: com o olho aberto a região tem íris/pupila escuras e bordas
// fortes (pálpebra, íris, esclera); fechado, vira pele lisa. Em vídeo real essa métrica
// caiu ~40% numa piscada, com separação aberto/fechado maior que a do EAR.
//
// Tudo é normalizado pela luminância de uma faixa de pele logo abaixo do olho, para
// funcionar com iluminação e tons de pele diferentes.

const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Tamanho fixo de amostragem: o custo independe da resolução da câmera.
const SAMPLE_W = 48;

// Região amostrada: o olho (altura = 0.6 x largura) e, abaixo, uma faixa de pele de referência.
export function eyeRegion(eye) {
    const xs = eye.map((p) => p.x), ys = eye.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return { sx: cx - w * 0.5, sy: cy - w * 0.3, sw: w, sh: w * 1.0, eyeFrac: 0.6, skinFrac: 0.75 };
}

function eyeOpenness(source, eye) {
    const { sx, sy, sw, sh } = eyeRegion(eye);
    if (!(sw > 4)) return null;
    const scale = SAMPLE_W / sw;
    const W = SAMPLE_W, H = Math.max(8, Math.round(sh * scale));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;

    const eyeH = Math.round(H * 0.6);            // linhas 0..eyeH-1: olho
    const skinY0 = Math.round(H * 0.75);         // linhas skinY0..H-1: pele abaixo do olho
    let skin = 0, skinN = 0;
    for (let y = skinY0; y < H; y++) for (let x = 0; x < W; x++) { skin += lum(d, (y * W + x) * 4); skinN++; }
    skin /= skinN;
    if (!(skin > 5)) return null;

    let dark = 0, edge = 0, prevRow = null;
    for (let y = 0; y < eyeH; y++) {
        const row = new Float32Array(W);
        for (let x = 0; x < W; x++) {
            const l = lum(d, (y * W + x) * 4);
            row[x] = l;
            if (l < skin * 0.55) dark++;
            if (prevRow) edge += Math.abs(l - prevRow[x]);
        }
        prevRow = row;
    }
    const n = W * eyeH;
    // Soma (não produto): se a pele for escura e quase nenhum pixel passar no corte de
    // "escuro", as bordas íris/esclera/pálpebra ainda carregam o sinal.
    return dark / n + 6 * (edge / (n * skin));
}

// Mede os dois olhos. Retorna { left, right, value } ou null se não deu para medir.
export function measureEyes(source, landmarks) {
    const left = eyeOpenness(source, landmarks.getLeftEye());
    const right = eyeOpenness(source, landmarks.getRightEye());
    if (left == null || right == null) return null;
    return { left, right, value: (left + right) / 2 };
}

// Deslocamento do rosto entre frames, como fração da distância entre os olhos.
// Usa só contorno do rosto e nariz (pontos que não mexem quando o olho pisca).
export function faceAnchor(landmarks) {
    const pts = landmarks.positions.filter((_, k) => k <= 16 || (k >= 27 && k <= 35));
    const l = landmarks.getLeftEye()[0], r = landmarks.getRightEye()[3];
    return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        scale: Math.hypot(r.x - l.x, r.y - l.y),
    };
}

export function faceMotion(prev, cur) {
    if (!prev) return 0;
    return Math.hypot(cur.x - prev.x, cur.y - prev.y) / cur.scale + Math.abs(cur.scale / prev.scale - 1);
}
