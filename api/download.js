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
    const match = text.match(/OURBOOKS_OUTPUT:(.+)/);
    if (match) outputFile = match[1].trim();
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

    if (code !== 0 || !outputFile) {
      cleanup(outputDir);
      const msg = stderrBuf.trim() || `Il provider è terminato con codice ${code}`;
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
