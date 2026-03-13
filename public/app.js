/* global state */
let providers = {};
let selectedProvider = null;
let running = false;
let abortController = null;

/* DOM refs */
const providerList    = document.getElementById('providerList');
const providerGrid    = document.getElementById('providerGrid');
const welcomeState    = document.getElementById('welcomeState');
const downloadForm    = document.getElementById('downloadForm');
const formFields      = document.getElementById('formFields');
const providerEmoji   = document.getElementById('providerEmoji');
const providerTitle   = document.getElementById('providerTitle');
const providerDesc    = document.getElementById('providerDesc');
const downloadFormEl  = document.getElementById('downloadFormEl');
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const terminalSection = document.getElementById('terminalSection');
const terminal        = document.getElementById('terminal');
const clearBtn        = document.getElementById('clearBtn');

/* ─── Fetch providers ─── */
async function init() {
  try {
    const res = await fetch('/api/providers.js');
    providers = await res.json();
    renderSidebar();
    renderGrid();
    appendTerminal('Pronto.\n', 'muted');
    terminalSection.classList.remove('hidden');
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

function selectProvider(id) {
  selectedProvider = id;

  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === id);
  });

  const p = providers[id];
  providerEmoji.textContent = p.emoji;
  providerTitle.textContent = p.label;
  if (providerDesc) providerDesc.textContent = p.description || '';

  formFields.innerHTML = '';
  for (const field of p.fields) {
    formFields.appendChild(buildField(field));
  }

  if (id === 'sanoma') setupSanomaGediLoader();
  if (id === 'dibooklaterza') setupLaterzeBookLoader();

  welcomeState.classList.add('hidden');
  downloadForm.classList.remove('hidden');
}

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
      for (const opt of (field.options || [])) {
        const o = document.createElement('option');
        o.value = o.textContent = opt;
        input.appendChild(o);
      }
    } else {
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

let sanomaSyncTimer = null;
let sanomaLastCredentialsKey = '';
let sanomaSyncRequestId = 0;
function setupSanomaGediLoader() {
  clearTimeout(sanomaSyncTimer);

  const idField       = document.getElementById('field-id');
  const passwordField = document.getElementById('field-password');
  const gediField     = document.getElementById('field-gedi');

  if (!idField || !passwordField || !gediField) return;

  async function syncGedi() {
    clearTimeout(sanomaSyncTimer);

    const id       = idField.value?.trim();
    const password = passwordField.value?.trim();

    if (!id || !password) {
      sanomaLastCredentialsKey = '';
      gediField.innerHTML = '<option value="">Inserisci email e password</option>';
      gediField.disabled = true;
      return;
    }

    const credentialsKey = `${id}::${password}`;
    if (credentialsKey === sanomaLastCredentialsKey) return;

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

  syncGedi();
}

let laterzaSyncTimer = null;
let laterzaLastCredentialsKey = '';
let laterzaSyncRequestId = 0;
function setupLaterzeBookLoader() {
  clearTimeout(laterzaSyncTimer);

  const usernameField = document.getElementById('field-username');
  const passwordField = document.getElementById('field-password');
  const isbnField     = document.getElementById('field-isbn');

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

downloadFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedProvider || running) return;

  const formData = new FormData(downloadFormEl);
  const options = { provider: selectedProvider };
  for (const [k, v] of formData.entries()) {
    if (v) options[k] = v;
  }

  terminal.textContent = '';
  terminalSection.classList.remove('hidden');
  setRunning(true);
  appendTerminal(`▶ Avvio provider: ${selectedProvider}\n`, 'blue');
  appendTerminal('Elaborazione in corso, attendere...\n', 'muted');

  abortController = new AbortController();

  try {
    const res = await fetch('/api/download.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: abortController.signal
    });

    if (!res.ok) {
      let errMsg = `Errore HTTP ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData.error || errMsg;
      } catch {}
      appendTerminal(`\n✗ ${errMsg}\n`, 'stderr');
      setRunning(false);
      return;
    }

    const contentType = res.headers.get('Content-Type') || '';

    if (contentType.includes('application/json')) {
      const data = await res.json();
      appendTerminal(`\n✓ ${data.message || 'Completato.'}\n`, 'green');
    } else {
      /* Binary file response — trigger browser download */
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      let fileName = 'libro.pdf';
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
      if (match) fileName = decodeURIComponent(match[1]);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);

      appendTerminal(`\n✓ Download completato!\n`, 'green');

      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.textContent = `\n📄 Salva: ${fileName}\n`;
      link.className = 'btn btn-download';
      link.style.display = 'inline-flex';
      link.style.marginTop = '8px';
      terminal.appendChild(link);
      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      appendTerminal('\n⛔ Download interrotto.\n', 'yellow');
    } else {
      appendTerminal(`\n✗ Errore: ${err.message}\n`, 'stderr');
    }
  } finally {
    setRunning(false);
    abortController = null;
  }
});

stopBtn.addEventListener('click', () => {
  if (abortController) abortController.abort();
});

clearBtn.addEventListener('click', () => {
  terminal.textContent = '';
});

function setRunning(state) {
  running = state;
  startBtn.disabled = state;
  stopBtn.classList.toggle('hidden', !state);
}

function appendTerminal(text, type = 'normal') {
  const span = document.createElement('span');
  const classMap = {
    normal: '',
    muted:  't-muted',
    stderr: 't-red',
    green:  't-green',
    blue:   't-blue',
    yellow: 't-yellow',
  };
  if (classMap[type]) span.className = classMap[type];
  span.textContent = text;
  terminal.appendChild(span);
  terminal.scrollTop = terminal.scrollHeight;
}

init();
