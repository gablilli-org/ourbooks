import path from "path";
import { fileURLToPath } from "url";
import { PROVIDER_IDS } from "./_providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
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
    res.status(400).json({ error: `Unknown provider: ${provider}. Available providers: ${PROVIDER_IDS.join(", ")}` });
    return;
  }

  try {
    const providerPath = path.resolve(__dirname, `../providers/${provider}.js`);
    const module = await import(providerPath);

    if (!module.run) {
      res.status(500).json({ error: "Provider does not export a run() function" });
      return;
    }

    const result = await module.run(options);
    res.status(200).json({
      success: true,
      message: `Provider ${provider} completed successfully.`,
      ...(result && typeof result === "object" ? { data: result } : {})
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
