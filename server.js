import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use('/downloads', express.static(DOWNLOADS_DIR));
app.use(express.static(path.join(__dirname, 'ui')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PROVIDERS = {
  sanoma: {
    label: 'Sanoma',
    emoji: '📙',
    fields: [
      { name: 'id', label: 'Email account', type: 'text', required: true, placeholder: 'user@email.com' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'gedi', label: 'GEDI libro', type: 'select', required: true, placeholder: 'Es: 123456', dynamicOptions: true },
      { name: 'output', label: 'Nome file output', type: 'text', required: false, placeholder: 'libro.pdf' },
    ]
  },
  hubscuola: {
    label: 'HubScuola',
    emoji: '📘',
    fields: [
      { name: 'username', label: 'Email account', type: 'text', required: true, placeholder: 'user@email.com' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'platform', label: 'Piattaforma', type: 'select', required: true, options: ['hubyoung', 'hubkids'] },
      { name: 'volumeId', label: 'Libro', type: 'select', required: true, dynamicOptions: true },
      { name: 'file', label: 'Nome file output', type: 'text', required: false, placeholder: 'libro.pdf' },
    ]
  },
  dibooklaterza: {
    label: 'Laterza',
    emoji: '📗',
    fields: [
      { name: 'username', label: 'Email account', type: 'text', required: true, placeholder: 'user@email.com' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'isbn', label: 'Libro', type: 'select', required: true, placeholder: 'Seleziona un libro', dynamicOptions: true },
      { name: 'output', label: 'Nome file output', type: 'text', required: false, placeholder: 'libro.pdf' },
    ]
  },
  zanichelli: {
    label: 'Zanichelli',
    emoji: '📕',
    fields: [
      { name: 'username', label: 'Email account', type: 'text', required: true, placeholder: 'user@email.com' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'isbn', label: 'ISBN', type: 'text', required: false, placeholder: '978...' },
    ]
  },
  bsmart: {
    label: 'Bsmart / Digibook24',
    emoji: '📔',
    fields: [
      { name: 'site', label: 'Sito', type: 'select', required: true, options: ['bsmart', 'digibook24'] },
      { name: 'username', label: 'Username (Email)', type: 'text', required: true, placeholder: 'Email' },
      { name: 'password', label: 'Password', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'cookie', label: 'Cookie V1 (Opzionale, sostituisce Auth)', type: 'text', required: false, placeholder: '' },
      { name: 'bookId', label: 'Book ID', type: 'text', required: false, placeholder: 'Es: 123456' },
      { name: 'output', label: 'Nome file output', type: 'text', required: false, placeholder: 'libro.pdf' },
    ]
  }
};

app.get('/api/providers.js', (req, res) => {
  res.json(PROVIDERS);
});

app.post('/api/dibooklaterza-books', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: 'Campi richiesti: username, password' });
    return;
  }

  try {
    const loginRes = await fetch('https://api.dibooklaterza.it/api/identity/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!loginRes.ok) {
      res.status(401).json({ error: 'Login fallito: credenziali non valide' });
      return;
    }

    const loginData = await loginRes.json();
    const jwt = loginData.jwt;
    const laterzaUserId = loginData.laterzaUserId;

    if (!jwt || !laterzaUserId) {
      res.status(401).json({ error: 'Login fallito: risposta non valida' });
      return;
    }

    const booksRes = await fetch(`https://api.dibooklaterza.it/api/management/books/${laterzaUserId}`, {
      headers: { 'Authorization': `Bearer ${jwt}` }
    });

    if (!booksRes.ok) {
      res.status(502).json({ error: 'Impossibile recuperare i libri' });
      return;
    }

    const booksData = await booksRes.json();
    const libreriaCategory = (booksData.categories || []).find(c => c.name?.toLowerCase() === 'libreria');

    if (!libreriaCategory) {
      res.status(404).json({ error: "Categoria 'libreria' non trovata" });
      return;
    }

    const books = (booksData.books || [])
      .filter(b => b.category === libreriaCategory.id && b.permitDownload && b.existPdf)
      .map(b => ({ isbn: b.identifier, title: b.title, authors: b.originalAuthors }));

    res.status(200).json({ books });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sanoma-gedi', async (req, res) => {
  const { id, password } = req.body || {};

  if (!id || !password) {
    res.status(400).json({ error: "Campi richiesti: id, password" });
    return;
  }

  try {
    const SANOMA_BASE_URLS = [
      process.env.SANOMA_API_BASE,
      'https://npmoffline.sanoma.it/mcs/api/v1',
      'https://npmoffline.sanoma.it/api/v1',
    ].filter(Boolean);

    async function fetchSanomaJson(pathname, init = {}) {
      let lastError = null;

      for (const base of SANOMA_BASE_URLS) {
        const url = `${base}${pathname}`;
        try {
          const response = await fetch(url, init);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = payload?.message || payload?.error || `HTTP ${response.status}`;
            throw new Error(`${url}: ${message}`);
          }
          return payload;
        } catch (err) {
          lastError = err;
        }
      }

      throw lastError || new Error('Sanoma API request failed');
    }

    function getAccessToken(userAuth) {
      return userAuth?.result?.data?.access_token
        || userAuth?.data?.access_token
        || userAuth?.access_token
        || userAuth?.token
        || null;
    }

    function normalizeBooksPage(payload) {
      const rows = payload?.result?.data || payload?.data || payload?.books || [];
      const totalSize = payload?.result?.total_size ?? payload?.total_size ?? payload?.total ?? rows.length;
      const rawPageSize = payload?.result?.page_size ?? payload?.page_size ?? rows.length;
      const pageSize = rawPageSize || 1;

      return {
        rows: Array.isArray(rows) ? rows : [],
        pages: Math.max(1, Math.ceil(totalSize / pageSize)),
      };
    }

    const userAuth = await fetchSanomaJson('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timezone-Offset': '+0200'
      },
      body: JSON.stringify({ id, password }),
    });

    if (!userAuth || (userAuth.code != null && userAuth.code !== 0)) {
      res.status(401).json({ error: 'Failed to log in: ' + (userAuth.message || 'Unknown error') });
      return;
    }

    const accessToken = getAccessToken(userAuth);
    if (!accessToken) {
      res.status(502).json({ error: 'Login OK ma token non presente nella risposta API' });
      return;
    }

    const books = {};
    let pages = 1;

    for (let i = 1; i <= pages; i++) {
      const newBooks = await fetchSanomaJson(`/books?app=true&page=${i}`, {
        headers: { 'X-Auth-Token': 'Bearer ' + accessToken },
      });

      const pageInfo = normalizeBooksPage(newBooks);
      pages = pageInfo.pages;

      for (const book of pageInfo.rows) {
        if (!book?.gedi) continue;
        books[book.gedi] = book;
      }
    }

    const bookList = Object.entries(books).map(([gedi, book]) => ({
      gedi,
      name: book.name || book.title || `GEDI ${gedi}`
    }));

    res.status(200).json({ success: true, books: bookList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hubscuola-books', async (req, res) => {
  const { username, password, platform } = req.body || {};

  if (!username || !password || !platform) {
    res.status(400).json({ error: 'Campi richiesti: username, password, platform' });
    return;
  }

  try {
    const { tokenId, normalizedPlatform } = await hubscuolaInternalLogin({ username, password, platform });

    const booksRes = await fetch(
      `https://ms-api.hubscuola.it/getLibrary/${normalizedPlatform}?version=7.6&platform=web&app=v2`,
      {
        headers: {
          'Token-Session': tokenId,
          'Accept': 'application/json'
        }
      }
    );

    const booksJson = await booksRes.json().catch(() => []);

    if (!booksRes.ok) {
      const msg = booksJson?.message || booksJson?.error || `Errore libreria HubScuola (${booksRes.status})`;
      res.status(booksRes.status).json({ error: msg });
      return;
    }

    const rawBooks = Array.isArray(booksJson) ? booksJson : (booksJson?.data || []);
    const books = rawBooks
      .filter((b) => b && (b.id || b.volumeId))
      .map((b) => ({
        volumeId: String(b.id || b.volumeId),
        title: b.title || b.name || `Libro ${b.id || b.volumeId}`,
        subtitle: b.subtitle || '',
        editor: b.editor || ''
      }));

    res.status(200).json({ tokenId, books });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const activeProcesses = new Map();

wss.on('connection', (ws) => {
  let activeProcess = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'start') {
      const { provider, options } = msg;

      if (!PROVIDERS[provider]) {
        ws.send(JSON.stringify({ type: 'error', text: 'Provider non valido.' }));
        return;
      }

      /* Validate that option keys are known fields for this provider */
      const knownFields = new Set(PROVIDERS[provider].fields.map(f => f.name));
      const safeOptions = {};
      for (const [key, value] of Object.entries(options || {})) {
        if (!knownFields.has(key)) continue;
        const str = String(value);
        /* Reject values that contain shell metacharacters */
        if (/[\r\n\0]/.test(str)) continue;
        safeOptions[key] = str;
      }

      const args = ['cli.js', '--provider', provider];


      // In container/cloud we prefer system pdftk over bundled jar for Laterza.
      if (provider === 'dibooklaterza') {
        args.push('--useSystemExecutable');
      }

      for (const [key, value] of Object.entries(safeOptions)) {
        if (value !== '') {
          args.push(`--${key}`, value);
        }
      }

      const sessionId = randomUUID();
      const sessionDownloadDir = path.join(DOWNLOADS_DIR, sessionId);
      fs.mkdirSync(sessionDownloadDir, { recursive: true });

      ws.send(JSON.stringify({ type: 'started', text: `▶ Avvio provider: ${provider}\n` }));

      activeProcess = spawn('node', args, {
        cwd: __dirname,
        env: {
          ...process.env,
          OURBOOKS_SESSION_ID: sessionId,
          OURBOOKS_OUTPUT_DIR: sessionDownloadDir,
          OURBOOKS_SESSION_TMP: path.join(__dirname, 'tmp', sessionId),
        }
      });

      activeProcesses.set(ws, activeProcess);

      activeProcess.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const match = text.match(/OURBOOKS_OUTPUT:(.+)/);
        if (match) {
          const fileName = path.basename(match[1].trim());
          ws.send(JSON.stringify({ type: 'file', url: `/downloads/${sessionId}/${fileName}`, name: fileName }));
        }
        const filtered = text.split('\n').filter(l => !l.startsWith('OURBOOKS_OUTPUT:')).join('\n');
        if (filtered) ws.send(JSON.stringify({ type: 'stdout', text: filtered }));
      });

      activeProcess.stderr.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'stderr', text: chunk.toString() }));
      });

      activeProcess.on('close', (code) => {
        activeProcesses.delete(ws);
        activeProcess = null;
        ws.send(JSON.stringify({
          type: 'done',
          text: `\n✅ Processo terminato con codice ${code}\n`,
          code
        }));
      });

      activeProcess.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', text: `\n❌ Errore: ${err.message}\n` }));
      });
    }

    if (msg.type === 'stop') {
      if (activeProcess) {
        activeProcess.kill('SIGTERM');
        activeProcess = null;
        ws.send(JSON.stringify({ type: 'stopped', text: '\n⛔ Processo interrotto.\n' }));
      }
    }
  });

  ws.on('close', () => {
    const proc = activeProcesses.get(ws);
    if (proc) {
      proc.kill('SIGTERM');
      activeProcesses.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`📚 ourbooks UI disponibile su http://localhost:${PORT}`);
});
