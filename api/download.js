import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import { PROVIDER_IDS } from "./_providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { provider, ...options } = req.body || {};

  if (!provider) {
    res.status(400).json({ error: "Missing required field: provider" });
    return;
  }

  if (!PROVIDER_IDS.includes(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}. Available: ${PROVIDER_IDS.join(", ")}` });
    return;
  }

  const sessionId = randomUUID();
  const outputDir = `/tmp/ourbooks-out-${sessionId}`;
  const tmpDir    = `/tmp/ourbooks-tmp-${sessionId}`;

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(tmpDir,    { recursive: true });
  } catch (err) {
    res.status(500).json({ error: `Impossibile creare directory temporanea: ${err.message}` });
    return;
  }

  const args = [path.join(PROJECT_ROOT, "cli.js"), "--provider", provider];
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") {
      args.push(`--${key}`, String(value));
    }
  }

  let outputFile = null;
  let stderrBuf  = "";
  let stdoutBuf  = "";

  const proc = spawn("node", args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      OURBOOKS_OUTPUT_DIR:   outputDir,
      OURBOOKS_SESSION_TMP:  tmpDir,
    },
  });

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdoutBuf += text;

    // Parse per-line to handle multiple messages in one chunk.
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      const match = line.match(/OURBOOKS_OUTPUT:(.+)/);
      if (match) outputFile = match[1].trim();
    }
  });

  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  proc.on("error", (err) => {
    cleanup(outputDir, tmpDir);
    res.status(500).json({ error: `Impossibile avviare il provider: ${err.message}` });
  });

  proc.on("close", (code) => {
    cleanup(tmpDir);

    // Flush last partial stdout line in case process exited without trailing newline.
    if (!outputFile && stdoutBuf) {
      const match = stdoutBuf.match(/OURBOOKS_OUTPUT:(.+)/);
      if (match) outputFile = match[1].trim();
    }

    // Fallback: if provider exited successfully but marker was not emitted, pick latest PDF in output dir.
    if (!outputFile && code === 0) {
      outputFile = findLatestPdfInDir(outputDir);
    }

    if (code !== 0 || !outputFile) {
      cleanup(outputDir);
      const msg = (stderrBuf.trim() || stdoutBuf.trim()) || `Il provider è terminato con codice ${code}`;
      res.status(500).json({ error: msg });
      return;
    }

    let fileContent;
    try {
      fileContent = fs.readFileSync(outputFile);
    } catch (err) {
      cleanup(outputDir);
      res.status(500).json({ error: `Impossibile leggere il file output: ${err.message}` });
      return;
    }

    const fileName   = path.basename(outputFile);
    const mimeType   = fileName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
    const encoded    = encodeURIComponent(fileName);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    res.setHeader("Content-Length", fileContent.length);
    res.status(200).end(fileContent);

    cleanup(outputDir);
  });
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function findLatestPdfInDir(rootDir) {
  const stack = [rootDir];
  let latest = null;

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;

      let mtime = 0;
      try {
        mtime = fs.statSync(fullPath).mtimeMs;
      } catch {
        continue;
      }

      if (!latest || mtime > latest.mtime) {
        latest = { file: fullPath, mtime };
      }
    }
  }

  return latest ? latest.file : null;
}
