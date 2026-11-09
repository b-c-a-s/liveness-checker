// Build de produção: gera dist/ com JS empacotado e minificado (esbuild),
// CSS do Tailwind por página embutido no HTML, HTML minificado, imagens em AVIF,
// preload dos modelos e arquivos pré-comprimidos (.br/.gz).
//
//   node tools/build.mjs            build único
//   node tools/build.mjs --serve    build + servidor em http://localhost:8001 com rebuild ao salvar
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { minify as minifyHtml } from 'html-minifier-terser';
import sharp from 'sharp';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const r = (...p) => path.join(ROOT, ...p);
const posix = (p) => p.split(path.sep).join('/');

const PAGES = [
    { html: 'index.html', entry: 'scripts/index.js', preloadModels: true },
    { html: 'settings.html', entry: 'scripts/settings.js' },
    { html: 'examples.html' },
    { html: 'examples/demo.html' },
];
const MODEL_FILES = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
];
const COMPRESSIBLE = /\.(html|js|css|json|svg)$|-shard\d+$/;

// O face-api.js não declara "sideEffects", o que impede o tree-shaking. Marcamos
// seus módulos como livres de efeitos colaterais para descartar redes não usadas.
// (O tfjs-core fica de fora: ele registra backends WebGL/CPU ao ser carregado.)
export const faceApiTreeShake = {
    name: 'face-api-tree-shake',
    setup(build) {
        build.onResolve({ filter: /^(\.|face-api\.js$)/ }, async (args) => {
            if (args.pluginData) return;
            if (args.path.startsWith('.') && !posix(args.resolveDir).includes('/face-api.js/')) return;
            const res = await build.resolve(args.path, {
                kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: true,
            });
            return res.errors.length ? undefined : { ...res, sideEffects: false };
        });
    },
};

const fileSize = (f) => fs.statSync(f).size;
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';

async function buildJs() {
    // Biblioteca publicada no npm (build/), também copiada para dist/build/.
    for (const minify of [false, true]) {
        await esbuild.build({
            entryPoints: [r('scripts/liveness-checker.js')],
            outfile: r('build', minify ? 'liveness-checker.min.js' : 'liveness-checker.js'),
            bundle: true, format: 'esm', target: 'es2020', minify, legalComments: 'none',
        });
    }
    fs.mkdirSync(path.join(DIST, 'build'), { recursive: true });
    for (const f of ['liveness-checker.js', 'liveness-checker.min.js']) {
        fs.copyFileSync(r('build', f), path.join(DIST, 'build', f));
    }

    // Páginas: code splitting (config.js compartilhado), nomes com hash para cache longo.
    const entries = PAGES.filter((p) => p.entry);
    const result = await esbuild.build({
        entryPoints: entries.map((p) => r(p.entry)),
        outdir: path.join(DIST, 'assets'),
        entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]',
        bundle: true, splitting: true, format: 'esm', target: 'es2020',
        minify: true, legalComments: 'none', metafile: true,
        plugins: [faceApiTreeShake],
    });

    // Mapeia entrada -> { arquivo de saída, chunks importados (para modulepreload) }.
    const map = {};
    for (const [out, meta] of Object.entries(result.metafile.outputs)) {
        if (!meta.entryPoint) continue;
        const rel = (f) => posix(path.relative(DIST, path.resolve(ROOT, f)));
        map[posix(path.relative(ROOT, path.resolve(ROOT, meta.entryPoint)))] = {
            file: rel(out),
            imports: meta.imports.filter((i) => i.kind === 'import-statement').map((i) => rel(i.path)),
        };
    }
    return map;
}

async function pageCss(htmlFile, entry) {
    const config = require(r('tailwind.config.cjs'));
    const content = [r(htmlFile)];
    if (entry) content.push(r(entry));
    const out = await postcss([tailwindcss({ ...config, content })])
        .process(fs.readFileSync(r('styles/input.css'), 'utf8'), { from: r('styles/input.css') });
    return (await esbuild.transform(out.css, { loader: 'css', minify: true })).code.trim();
}

async function buildImages() {
    const dir = r('images');
    const out = path.join(DIST, 'images');
    fs.mkdirSync(out, { recursive: true });
    const dims = {};
    for (const f of fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f))) {
        const src = path.join(dir, f);
        const dest = path.join(out, f.replace(/\.\w+$/, '.avif'));
        if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < fs.statSync(src).mtimeMs) {
            await sharp(src).avif({ quality: 50, effort: 6 }).toFile(dest);
        }
        const { width, height } = await sharp(src).metadata();
        dims[f] = { width, height, avif: path.basename(dest) };
    }
    return dims;
}

async function buildHtml(jsMap, imgDims) {
    for (const page of PAGES) {
        let html = fs.readFileSync(r(page.html), 'utf8');
        const depth = page.html.split('/').length - 1;
        const up = depth ? '../'.repeat(depth) : './';

        html = html.replace(/<link rel="stylesheet" href="[^"]*main\.css">/,
            `<style>${await pageCss(page.html, page.entry)}</style>`);

        if (page.entry) {
            const { file, imports } = jsMap[page.entry];
            const preloads = imports.map((i) => `<link rel="modulepreload" href="${up}${i}">`).join('');
            html = html.replace(/<script src="[^"]*" type="module" defer><\/script>/,
                `${preloads}<script type="module" src="${up}${file}"></script>`);
        }
        if (page.preloadModels) {
            // Baixa os modelos em paralelo com o JS, em vez de só depois que ele executa.
            const links = MODEL_FILES.map((f) =>
                `<link rel="preload" href="./models/${f}" as="fetch" crossorigin="anonymous">`).join('');
            html = html.replace('</head>', `${links}</head>`);
        }
        html = html.replace(/<img src="([^"]*\/images\/)([^"]+)"/g, (m, dir, name) => {
            const d = imgDims[name];
            if (!d) return m;
            return `<img src="${dir}${d.avif}" width="${d.width}" height="${d.height}" loading="lazy" decoding="async"`;
        });

        html = await minifyHtml(html, {
            collapseWhitespace: true, conservativeCollapse: false, removeComments: true,
            removeRedundantAttributes: true, removeScriptTypeAttributes: false,
            collapseBooleanAttributes: true, decodeEntities: true, sortAttributes: true, sortClassName: true,
            minifyJS: (code) => esbuild.transformSync(code, { minify: true, format: 'esm', target: 'es2020' }).code,
        });
        const dest = path.join(DIST, page.html);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, html);
    }
}

function copyModels() {
    const out = path.join(DIST, 'models');
    fs.mkdirSync(out, { recursive: true });
    for (const f of MODEL_FILES) {
        const src = r('models', f);
        if (f.endsWith('.json')) {
            fs.writeFileSync(path.join(out, f), JSON.stringify(JSON.parse(fs.readFileSync(src, 'utf8'))));
        } else {
            fs.copyFileSync(src, path.join(out, f));
        }
    }
}

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function precompress() {
    for (const f of walk(DIST)) {
        if (!COMPRESSIBLE.test(f)) continue;
        const buf = fs.readFileSync(f);
        fs.writeFileSync(f + '.br', brotliCompressSync(buf, {
            params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length },
        }));
        fs.writeFileSync(f + '.gz', gzipSync(buf, { level: 9 }));
    }
}

function report() {
    const rows = walk(DIST).filter((f) => !/\.(br|gz)$/.test(f)).sort();
    let raw = 0, br = 0;
    console.log('\n  arquivo'.padEnd(58) + 'bruto'.padStart(10) + 'brotli'.padStart(11));
    for (const f of rows) {
        const s = fileSize(f);
        const b = fs.existsSync(f + '.br') ? fileSize(f + '.br') : s;
        raw += s; br += b;
        console.log('  ' + posix(path.relative(DIST, f)).padEnd(55) + kb(s) + kb(b));
    }
    console.log('  ' + 'TOTAL'.padEnd(55) + kb(raw) + kb(br) + '\n');
}

export async function build({ quiet = false } = {}) {
    const t = performance.now();
    // Limpa dist/, mas preserva as imagens AVIF já codificadas (lentas de gerar).
    if (fs.existsSync(DIST)) {
        for (const e of fs.readdirSync(DIST)) {
            if (e !== 'images') fs.rmSync(path.join(DIST, e), { recursive: true, force: true });
        }
    }
    fs.mkdirSync(DIST, { recursive: true });
    const [jsMap, imgDims] = await Promise.all([buildJs(), buildImages()]);
    await buildHtml(jsMap, imgDims);
    copyModels();
    precompress();
    if (!quiet) report();
    console.log(`  build concluído em ${Math.round(performance.now() - t)} ms`);
}

if (!import.meta.main) {
    // importado como módulo: não executa nada
} else if (process.argv.includes('--serve')) {
    await build();
    const { createServer } = require('http-server');
    createServer({ root: DIST, brotli: true, gzip: true, cache: -1 }).listen(8001, () =>
        console.log('  servindo dist/ em http://localhost:8001  (Ctrl+C para sair)'));
    let timer;
    const rebuild = (_, file) => {
        if (file && /(^|[\\/])(dist|node_modules|build)([\\/]|$)/.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => build({ quiet: true }).catch((e) => console.error(e.message)), 100);
    };
    for (const d of ['scripts', 'styles', 'examples', 'images', 'models']) fs.watch(r(d), { recursive: true }, rebuild);
    fs.watch(ROOT, (ev, file) => file && /\.html$|tailwind\.config\.cjs$/.test(file) && rebuild(ev, file));
} else {
    await build();
}
