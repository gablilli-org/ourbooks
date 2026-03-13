export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: "Campi richiesti: username, password" });
    return;
  }

  try {
    const loginRes = await fetch("https://api.dibooklaterza.it/api/identity/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!loginRes.ok) {
      res.status(401).json({ error: "Login fallito: credenziali non valide" });
      return;
    }

    const loginData = await loginRes.json();
    const jwt = loginData.jwt;
    const laterzaUserId = loginData.laterzaUserId;

    if (!jwt || !laterzaUserId) {
      res.status(401).json({ error: "Login fallito: risposta non valida" });
      return;
    }

    const booksRes = await fetch(`https://api.dibooklaterza.it/api/management/books/${laterzaUserId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!booksRes.ok) {
      res.status(502).json({ error: "Impossibile recuperare i libri" });
      return;
    }

    const booksData = await booksRes.json();
    const libreriaCategory = (booksData.categories || []).find(
      (c) => c.name?.toLowerCase() === "libreria"
    );

    if (!libreriaCategory) {
      res.status(404).json({ error: "Categoria 'libreria' non trovata" });
      return;
    }

    const books = (booksData.books || [])
      .filter((b) => b.category === libreriaCategory.id && b.permitDownload && b.existPdf)
      .map((b) => ({ isbn: b.identifier, title: b.title, authors: b.originalAuthors }));

    res.status(200).json({ books });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
