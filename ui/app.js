/* global state */
let providers = {};
let selectedProvider = null;
let ws = null;
let running = false;

/* DOM refs */
const providerList   = document.getElementById('providerList');
const providerGrid   = document.getElementById('providerGrid');
const welcomeState   = document.getElementById('welcomeState');
const downloadForm   = document.getElementById('downloadForm');
const formFields     = document.getElementById('formFields');
const providerEmoji  = document.getElementById('providerEmoji');
const providerTitle  = document.getElementById('providerTitle');
const downloadFormEl = document.getElementById('downloadFormEl');
const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');
const terminalSection = document.getElementById('terminalSection');
const terminal       = document.getElementById('terminal');
const clearBtn       = document.getElementById('clearBtn');

/* ─── Fetch providers ─── */
async function init() {
  try {
    const res = await fetch('/api/providers.js');
    providers = await res.json();
    renderSidebar();
    renderGrid();
    connectWS();
  } catch (err) {
    appendTerminal(`\nErrore di connessione al server: ${err.message}\n`, 'stderr');
    terminalSection.classList.remove('hidden');
  }
}

/* ─── Sidebar ─── */
function renderSidebar() {
  providerList.innerHTML = '';
  for (const [id, p] of Object.entries(providers)) {
    const btn = document.createElement('button');
    btn.className = 'provider-btn';
    btn.dataset.id = id;
    btn.innerHTML = `<span class="p-emoji">${p.emoji}</span><span class="p-label">${p.label}</span>`;
    btn.addEventListener('click', () => selectProvider(id));
    providerList.appendChild(btn);
  }
}

/* ─── Welcome grid ─── */
function renderGrid() {
  providerGrid.innerHTML = '';
  for (const [id, p] of Object.entries(providers)) {
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.innerHTML = `<span class="pc-emoji">${p.emoji}</span><span class="pc-label">${p.label}</span>`;
    card.addEventListener('click', () => selectProvider(id));
    providerGrid.appendChild(card);
  }
}

/* ─── Select provider ─── */
function selectProvider(id) {
  selectedProvider = id;

  /* update sidebar active state */
  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === id);
  });

  const p = providers[id];

  /* update form header */
  providerEmoji.textContent = p.emoji;
  providerTitle.textContent = p.label;

  /* render fields */
  formFields.innerHTML = '';
  for (const field of p.fields) {
    formFields.appendChild(buildField(field));
  }

  /* show form, hide welcome */
  welcomeState.classList.add('hidden');
  downloadForm.classList.remove('hidden');
}

/* ─── Build a form field ─── */
function buildField(field) {
  const group = document.createElement('div');
  group.className = 'field-group';

  const label = document.createElement('label');
  label.setAttribute('for', `field-${field.name}`);
  label.innerHTML = field.label +
    (field.required
      ? `<span class="required-badge">*</span>`
      : `<span class="optional-badge">(opzionale)</span>`);

  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    for (const opt of field.options) {
      const o = document.createElement('option');
      o.value = o.textContent = opt;
      input.appendChild(o);
    }
  } else {
    input = document.createElement('input');
    input.type = field.type;
    input.placeholder = field.placeholder || '';
    if (field.required) input.required = true;
  }

  input.id = `field-${field.name}`;
  input.name = field.name;

  group.appendChild(label);
  group.appendChild(input);
  return group;
}

/* ─── WebSocket ─── */
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    appendTerminal('Connesso al server.\n', 'muted');
    terminalSection.classList.remove('hidden');
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'started':
        setRunning(true);
        appendTerminal(msg.text, 'blue');
        break;
      case 'stdout':
        appendTerminal(msg.text, 'normal');
        break;
      case 'stderr':
        appendTerminal(msg.text, 'stderr');
        break;
      case 'done':
        setRunning(false);
        appendTerminal(msg.text, msg.code === 0 ? 'green' : 'red');
        break;
      case 'stopped':
        setRunning(false);
        appendTerminal(msg.text, 'yellow');
        break;
      case 'error':
        setRunning(false);
        appendTerminal(msg.text, 'stderr');
        break;
    }
  };

  ws.onclose = () => {
    appendTerminal('\nConnessione chiusa. Ricarica la pagina per riconnetterti.\n', 'muted');
    setRunning(false);
  };

  ws.onerror = () => {
    appendTerminal('\nErrore WebSocket.\n', 'stderr');
  };
}

/* ─── Start download ─── */
downloadFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!selectedProvider || !ws || ws.readyState !== WebSocket.OPEN) return;

  const formData = new FormData(downloadFormEl);
  const options = {};
  for (const [k, v] of formData.entries()) {
    if (v) options[k] = v;
  }

  terminal.textContent = '';
  ws.send(JSON.stringify({ type: 'start', provider: selectedProvider, options }));
});

/* ─── Stop ─── */
stopBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }));
  }
});

/* ─── Clear terminal ─── */
clearBtn.addEventListener('click', () => {
  terminal.textContent = '';
});

/* ─── Helpers ─── */
function setRunning(state) {
  running = state;
  startBtn.disabled = state;
  stopBtn.classList.toggle('hidden', !state);
}

function appendTerminal(text, style) {
  const span = document.createElement('span');

  if (style === 'stderr' || style === 'red') {
    span.className = 't-red';
  } else if (style === 'green') {
    span.className = 't-green';
  } else if (style === 'yellow') {
    span.className = 't-yellow';
  } else if (style === 'blue') {
    span.className = 't-blue';
  } else if (style === 'muted') {
    span.className = 't-muted';
  }

  span.textContent = text;
  terminal.appendChild(span);
  terminal.scrollTop = terminal.scrollHeight;
}

/* ─── Boot ─── */
init();
