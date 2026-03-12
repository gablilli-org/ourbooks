import fetch from 'node-fetch';

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, password } = req.body || {};

  if (!id || !password) {
    res.status(400).json({ error: "Missing required fields: id, password" });
    return;
  }

  try {
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

    res.status(200).json({
      success: true,
      books: bookList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
