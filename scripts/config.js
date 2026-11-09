// Configuração do liveness checker. Valores editados em settings.html ficam
// no localStorage do navegador e são mesclados sobre estes padrões.
export const STORAGE_KEY = 'livenessCheckerConfig.v4'; // v4: piscada medida pelos pixels do olho

export const FIELDS = [
    // group, key, label, default, type, step, min, max, help
    ['Piscada', 'blinkDropRatio', 'Queda do sinal para olho fechado', 0.75, 'number', 0.01, 0.4, 0.95, 'A abertura do olho é medida pelos pixels (íris escura e bordas da pálpebra). Olho conta como fechado quando o sinal cai abaixo desta fração do valor de olho aberto (0.75 = queda de 25%; numa piscada real cai ~40%). Aumente se piscadas não são detectadas; diminua se houver falsos positivos.'],
    ['Piscada', 'blinkMaxMotion', 'Movimento máximo do rosto', 0.04, 'number', 0.005, 0.01, 0.2, 'Frames com o rosto/câmera se movendo mais que esta fração da distância entre os olhos são ignorados (borrão imita olho fechado). Numa piscada o rosto se move < 0.03.'],
    ['Piscada', 'blinkMinFrames', 'Frames mínimos com olho fechado', 1, 'number', 1, 1, 10, 'Quantos frames seguidos com olho fechado formam uma piscada. Com câmera/PC lento, mantenha 1.'],
    ['Piscada', 'blinksRequired', 'Piscadas exigidas', 1, 'number', 1, 1, 10, 'Quantidade de piscadas necessárias.'],
    ['Piscada', 'blinkTimeoutMs', 'Tempo limite da piscada (ms)', 10000, 'number', 500, 1000, 120000, 'Se estourar, a contagem de piscadas recomeça.'],
    ['Giro de cabeça', 'turnTolerance', 'Tolerância do giro', 0.25, 'number', 0.01, 0.05, 1, 'Fração da distância entre olhos. Maior = giro menos exigente.'],
    ['Giro de cabeça', 'straightTolerance', 'Tolerância de rosto de frente', 0.125, 'number', 0.005, 0.02, 0.5, 'Maior = aceita rosto menos alinhado ao olhar para a frente.'],
    ['Detecção', 'faceScoreMin', 'Score mínimo do rosto (passo final)', 0.85, 'number', 0.01, 0.3, 1, 'Confiança mínima da detecção ao olhar para a frente.'],
    ['Detecção', 'detectorScoreThreshold', 'Score mínimo do detector', 0.5, 'number', 0.05, 0.1, 0.95, 'scoreThreshold do TinyFaceDetector.'],
    ['Detecção', 'detectorInputSize', 'Tamanho de entrada do detector', 224, 'select:128,160,224,320,416,512,608', 32, 128, 608, 'Maior = mais preciso e mais lento.'],
    ['Detecção', 'frameIntervalMs', 'Intervalo entre frames (ms)', 100, 'number', 10, 30, 1000, 'Usado nas etapas de giro. Na etapa de piscada os frames são processados sem espera.'],
    ['Depuração', 'showDebug', 'Mostrar sinal do olho na tela', false, 'checkbox', null, null, null, 'Exibe o sinal do olho, linha de base, limiar, movimento e fps ao vivo para ajudar a calibrar.'],
];

export const DEFAULTS = Object.fromEntries(FIELDS.map(f => [f[1], f[3]]));

export function loadConfig() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) { /* ignora */ }
    const config = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        if (typeof saved[key] === typeof DEFAULTS[key] && !Number.isNaN(saved[key])) {
            config[key] = saved[key];
        }
    }
    return config;
}

export function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resetConfig() {
    localStorage.removeItem(STORAGE_KEY);
}
