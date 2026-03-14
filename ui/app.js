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

  /* Setup Sanoma GEDI loader */
  if (id === 'sanoma') {
    setupSanomaGediLoader();
  }

  if (id === 'dibooklaterza') {
    setupLaterzeBookLoader();
  }

  if (id === 'hubscuola') {
    setupHubscuolaBookLoader();
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
    input.dataset.dynamicOptions = field.dynamicOptions ? 'true' : 'false';
    
    if (!field.dynamicOptions) {
      // Static options
      for (const opt of (field.options || [])) {
        const o = document.createElement('option');
        o.value = o.textContent = opt;
        input.appendChild(o);
      }
    } else {
      // Dynamic options - add placeholder
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Caricamento...';
      input.appendChild(o);
      input.disabled = true;
    }
  } else if (field.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.value = 'on';
    group.className += ' field-group--checkbox';
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

/* ─── Setup Sanoma GEDI loader ─── */
let sanomaSyncTimer = null;
let sanomaLastCredentialsKey = '';
let sanomaSyncRequestId = 0;
function setupSanomaGediLoader() {
  clearTimeout(sanomaSyncTimer);
  
  const idField = document.getElementById('field-id');
  const passwordField = document.getElementById('field-password');
  const gediField = document.getElementById('field-gedi');

  if (!idField || !passwordField || !gediField) return;

  async function syncGedi() {
    clearTimeout(sanomaSyncTimer);
    
    const id = idField.value?.trim();
    const password = passwordField.value?.trim();

    if (!id || !password) {
      sanomaLastCredentialsKey = '';
      gediField.innerHTML = '<option value="">Inserisci email e password</option>';
      gediField.disabled = true;
      return;
    }

    const credentialsKey = `${id}::${password}`;
    if (credentialsKey === sanomaLastCredentialsKey) {
      return;
    }

    sanomaLastCredentialsKey = credentialsKey;
    const requestId = ++sanomaSyncRequestId;

    gediField.innerHTML = '<option value="">Caricamento libri...</option>';
    gediField.disabled = true;

    try {
      const res = await fetch('/api/sanoma-gedi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
      });

      const data = await res.json();

      if (requestId !== sanomaSyncRequestId) return;

      if (!res.ok) {
        gediField.innerHTML = `<option value="">${data.error || 'Errore di caricamento'}</option>`;
        return;
      }

      gediField.innerHTML = '<option value="">Seleziona un libro</option>';
      for (const book of data.books) {
        const opt = document.createElement('option');
        opt.value = book.gedi;
        opt.textContent = book.name;
        gediField.appendChild(opt);
      }
      gediField.disabled = false;
    } catch (err) {
      if (requestId !== sanomaSyncRequestId) return;
      gediField.innerHTML = `<option value="">Errore: ${err.message}</option>`;
    }
  }

  idField.addEventListener('input', () => {
    clearTimeout(sanomaSyncTimer);
    sanomaSyncTimer = setTimeout(syncGedi, 450);
  });
  passwordField.addEventListener('input', () => {
    clearTimeout(sanomaSyncTimer);
    sanomaSyncTimer = setTimeout(syncGedi, 450);
  });

  /* Initial load */
  syncGedi();
}

/* ─── Laterza book loader ─── */
let laterzaSyncTimer = null;
let laterzaLastCredentialsKey = '';
let laterzaSyncRequestId = 0;
function setupLaterzeBookLoader() {
  clearTimeout(laterzaSyncTimer);

  const usernameField = document.getElementById('field-username');
  const passwordField = document.getElementById('field-password');
  const isbnField = document.getElementById('field-isbn');

  if (!usernameField || !passwordField || !isbnField) return;

  async function syncBooks() {
    clearTimeout(laterzaSyncTimer);

    const username = usernameField.value?.trim();
    const password = passwordField.value?.trim();

    if (!username || !password) {
      laterzaLastCredentialsKey = '';
      isbnField.innerHTML = '<option value="">Inserisci email e password</option>';
      isbnField.disabled = true;
      return;
    }

    const credentialsKey = `${username}::${password}`;
    if (credentialsKey === laterzaLastCredentialsKey) return;

    laterzaLastCredentialsKey = credentialsKey;
    const requestId = ++laterzaSyncRequestId;

    isbnField.innerHTML = '<option value="">Caricamento libri...</option>';
    isbnField.disabled = true;

    try {
      const res = await fetch('/api/dibooklaterza-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (requestId !== laterzaSyncRequestId) return;

      if (!res.ok) {
        isbnField.innerHTML = `<option value="">${data.error || 'Errore di caricamento'}</option>`;
        return;
      }

      isbnField.innerHTML = '<option value="">Seleziona un libro</option>';
      for (const book of data.books) {
        const opt = document.createElement('option');
        opt.value = book.isbn;
        opt.textContent = `${book.title}${book.authors ? ' — ' + book.authors : ''} (${book.isbn})`;
        isbnField.appendChild(opt);
      }
      isbnField.disabled = false;
    } catch (err) {
      if (requestId !== laterzaSyncRequestId) return;
      isbnField.innerHTML = `<option value="">Errore: ${err.message}</option>`;
    }
  }

  usernameField.addEventListener('input', () => {
    clearTimeout(laterzaSyncTimer);
    laterzaSyncTimer = setTimeout(syncBooks, 450);
  });
  passwordField.addEventListener('input', () => {
    clearTimeout(laterzaSyncTimer);
    laterzaSyncTimer = setTimeout(syncBooks, 450);
  });

  syncBooks();
}

/* ─── HubScuola books loader ─── */
let hubSyncTimer = null;
let hubLastCredentialsKey = '';
let hubSyncRequestId = 0;
function setupHubscuolaBookLoader() {
  clearTimeout(hubSyncTimer);

  const usernameField = document.getElementById('field-username');
  const passwordField = document.getElementById('field-password');
  const platformField = document.getElementById('field-platform');
  const volumeField = document.getElementById('field-volumeId');

  if (!usernameField || !passwordField || !platformField || !volumeField) return;

  async function syncHubBooks() {
    clearTimeout(hubSyncTimer);

    const username = usernameField.value?.trim();
    const password = passwordField.value?.trim();
    const platform = platformField.value?.trim();

    if (!username || !password || !platform) {
      hubLastCredentialsKey = '';
      volumeField.innerHTML = '<option value="">Inserisci email, password e piattaforma</option>';
      volumeField.disabled = true;
      return;
    }

    const credentialsKey = `${username}::${password}::${platform}`;
    if (credentialsKey === hubLastCredentialsKey) return;

    hubLastCredentialsKey = credentialsKey;
    const requestId = ++hubSyncRequestId;

    volumeField.innerHTML = '<option value="">Caricamento libri...</option>';
    volumeField.disabled = true;

    try {
      const res = await fetch('/api/hubscuola-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, platform })
      });

      const data = await res.json();
      if (requestId !== hubSyncRequestId) return;

      if (!res.ok) {
        volumeField.innerHTML = `<option value="">${data.error || 'Errore di caricamento'}</option>`;
        return;
      }

      if (!Array.isArray(data.books) || data.books.length === 0) {
        volumeField.innerHTML = '<option value="">Nessun libro trovato</option>';
        return;
      }

      volumeField.innerHTML = '<option value="">Seleziona un libro</option>';
      for (const book of data.books) {
        const opt = document.createElement('option');
        opt.value = book.volumeId;
        const parts = [book.title, book.subtitle, book.editor].filter(Boolean);
        opt.textContent = `${parts.join(' — ')} (${book.volumeId})`;
        volumeField.appendChild(opt);
      }
      volumeField.disabled = false;
    } catch (err) {
      if (requestId !== hubSyncRequestId) return;
      volumeField.innerHTML = `<option value="">Errore: ${err.message}</option>`;
    }
  }

  usernameField.addEventListener('input', () => {
    clearTimeout(hubSyncTimer);
    hubSyncTimer = setTimeout(syncHubBooks, 450);
  });
  passwordField.addEventListener('input', () => {
    clearTimeout(hubSyncTimer);
    hubSyncTimer = setTimeout(syncHubBooks, 450);
  });
  platformField.addEventListener('change', () => {
    clearTimeout(hubSyncTimer);
    hubSyncTimer = setTimeout(syncHubBooks, 150);
  });

  syncHubBooks();
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
      case 'file': {
        const link = document.createElement('a');
        link.href = msg.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `\n📄 Download pronto: ${msg.name} — clicca per aprire\n`;
        link.style.color = '#4ade80';
        link.style.display = 'block';
        terminal.appendChild(link);
        terminal.scrollTop = terminal.scrollHeight;
        window.open(msg.url, '_blank', 'noopener');
        break;
      }
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
