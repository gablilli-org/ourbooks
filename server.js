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
      { name: 'platform', label: 'Piattaforma', type: 'select', required: true, options: ['hubyoung', 'hubkids'] },
      { name: 'volumeId', label: 'Volume ID', type: 'text', required: true, placeholder: 'Es: 12345' },
      { name: 'token', label: 'Token sessione', type: 'text', required: true, placeholder: 'Token-Session' },
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
      { name: 'cookie', label: 'Cookie _bsw_session_v1_production', type: 'text', required: true, placeholder: 'Incolla il cookie qui' },
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
    // Import the handler dynamically
    const { default: handler } = await import('./api/sanoma-gedi.js');
    
    // Call the handler with proper request/response
    await handler(req, res);
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
