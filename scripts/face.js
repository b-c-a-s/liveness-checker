// Detecção mínima: importa só as duas redes usadas, para o bundler descartar
// o resto do face-api.js (SSD, MTCNN, reconhecimento, idade/gênero, expressões).
// Equivale a faceapi.detectSingleFace(input, opts).withFaceLandmarks().
import { TinyFaceDetector, FaceLandmark68Net, TinyFaceDetectorOptions, extractFaces } from 'face-api.js';

const detector = new TinyFaceDetector();
const landmarkNet = new FaceLandmark68Net();

export function loadModels(uri) {
    return Promise.all([detector.loadFromUri(uri), landmarkNet.loadFromUri(uri)]);
}

async function landmarksFor(input, detection) {
    const [face] = await extractFaces(input, [detection]);
    const landmarks = (await landmarkNet.detectLandmarks(face)).shiftBy(detection.box.x, detection.box.y);
    return { detection, landmarks };
}

export async function detectFace(input, { inputSize, scoreThreshold }) {
    const faces = await detector.locateFaces(input, new TinyFaceDetectorOptions({ inputSize, scoreThreshold }));
    if (!faces.length) return null;
    return landmarksFor(input, faces.reduce((best, f) => (f.score > best.score ? f : best)));
}

function centroid(landmarks) {
    const pts = landmarks.positions;
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

// Rastreamento: reaproveita a caixa do rosto de um resultado anterior de detectFace (anchor)
// e roda só a rede de landmarks. Retorna null se o rosto se moveu demais desde então,
// para o chamador voltar a usar o detector completo.
export async function trackFace(input, anchor) {
    const result = await landmarksFor(input, anchor.detection);
    const a = (anchor.center ??= centroid(anchor.landmarks));
    const c = centroid(result.landmarks);
    const drift = Math.hypot(c.x - a.x, c.y - a.y) / anchor.detection.box.width;
    return drift > 0.1 ? null : result;
}

// Compila os shaders WebGL antes do primeiro frame real, evitando travada no início.
export async function warmUp(opts) {
    const c = document.createElement('canvas');
    c.width = c.height = opts.inputSize;
    await detector.locateFaces(c, new TinyFaceDetectorOptions(opts));
    await landmarkNet.detectLandmarks(c);
}
