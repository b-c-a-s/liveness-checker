import { FIELDS, DEFAULTS, loadConfig, saveConfig, resetConfig } from './config.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('status');

function flash(msg) {
    status.textContent = msg;
    setTimeout(() => { status.textContent = ''; }, 2500);
}

function render() {
    const config = loadConfig();
    form.innerHTML = '';
    const groups = [...new Set(FIELDS.map(f => f[0]))];
    for (const group of groups) {
        const section = document.createElement('div');
        section.innerHTML = `<h2 class="text-xl font-semibold mb-3">${group}</h2>`;
        for (const [g, key, label, def, type, step, min, max, help] of FIELDS) {
            if (g !== group) continue;
            const row = document.createElement('div');
            row.className = 'mb-4';
            let input;
            if (type === 'checkbox') {
                input = `<input type="checkbox" id="${key}" ${config[key] ? 'checked' : ''} class="h-4 w-4">`;
            } else if (type.startsWith('select:')) {
                const opts = type.slice(7).split(',').map(v =>
                    `<option value="${v}" ${Number(v) === config[key] ? 'selected' : ''}>${v}</option>`).join('');
                input = `<select id="${key}" class="border rounded px-2 py-1">${opts}</select>`;
            } else {
                input = `<input type="number" id="${key}" value="${config[key]}" step="${step}" min="${min}" max="${max}" class="border rounded px-2 py-1 w-32">`;
            }
            row.innerHTML = `
                <label for="${key}" class="block text-gray-800 font-medium">${label}
                    <span class="text-gray-400 font-normal text-sm">(padrão: ${def})</span></label>
                <div class="mt-1">${input}</div>
                <p class="text-sm text-gray-500 mt-1">${help}</p>`;
            section.appendChild(row);
        }
        form.appendChild(section);
    }
    const buttons = document.createElement('div');
    buttons.className = 'flex gap-3';
    buttons.innerHTML = `
        <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">Salvar</button>
        <button type="button" id="reset" class="bg-gray-200 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-300">Restaurar padrões</button>`;
    form.appendChild(buttons);
    document.getElementById('reset').addEventListener('click', () => {
        resetConfig();
        render();
        flash('Padrões restaurados.');
    });
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const config = {};
    for (const key of Object.keys(DEFAULTS)) {
        const el = document.getElementById(key);
        if (typeof DEFAULTS[key] === 'boolean') {
            config[key] = el.checked;
        } else {
            const v = Number(el.value);
            config[key] = Number.isFinite(v) && el.value !== '' ? v : DEFAULTS[key];
        }
    }
    saveConfig(config);
    flash('Configurações salvas.');
});

render();
