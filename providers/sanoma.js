import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { URL } from 'url';

const PLACE_BOOKS_DATA_URL = 'https://place.sanoma.it/prodotti_digitali/__data.json';
const PLACE_BOOKS_PAGE_URL = 'https://place.sanoma.it/prodotti_digitali';
const DISPLAY_BOOKS_URL = 'https://npmitaly-pro-apidistribucion.sanoma.it/mcs/msproducts/api/products/display-books';
const EBOOK_ORIGIN = 'https://ebook.sanoma.it';
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
};

export async function loginSanoma(email, password) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ 
        jar,
        withCredentials: true,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    }));
    
    const redirectUri = 'https://place.sanoma.it/';
    let authUrl = null;
    let clientId = null;
    
    try {
        await client.get('https://place.sanoma.it/login', {
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });

        const initParams = new URLSearchParams({
            ref: 'https://place.sanoma.it/',
            context: '',
            text: email
        });

        const initRes = await client.post('https://place.sanoma.it/login?/status', initParams.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Origin': 'https://place.sanoma.it',
                'Referer': 'https://place.sanoma.it/login',
                'x-sveltekit-action': 'true'
            }
        });
        
        let data = initRes.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) {}
        }
        
        if (data && data.type === 'redirect' && data.location) {
            authUrl = data.location;
        }
    } catch (err) {
        if (err.response?.data?.type === 'redirect' && err.response?.data?.location) {
            authUrl = err.response.data.location;
        } else if (err.response?.headers?.location) {
            authUrl = err.response.headers.location;
        } else {
            throw err;
        }
    }
    
    if (!authUrl) throw new Error('Failed to get Auth0 redirect URL from /login?/status');
    if (!authUrl.startsWith('http')) authUrl = 'https://login.sanoma.it' + (authUrl.startsWith('/') ? '' : '/') + authUrl;
    
    const parsedInitUrl = new URL(authUrl);
    clientId = parsedInitUrl.searchParams.get('client_id');
    if (!clientId) throw new Error('Client ID missing from SvelteKit authorization URL');

    let authPageRes = await client.get(authUrl, {
        headers: {
            'Referer': 'https://place.sanoma.it/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
    });
    
    while (authPageRes.status >= 300 && authPageRes.status < 400 && authPageRes.headers.location) {
        let nextUrl = authPageRes.headers.location;
        if (!nextUrl.startsWith('http')) nextUrl = 'https://login.sanoma.it' + nextUrl;
        authUrl = nextUrl;
        authPageRes = await client.get(authUrl, {
            headers: {
                'Referer': 'https://place.sanoma.it/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });
    }
    
    const $ = cheerio.load(authPageRes.data);
    const cookies = await jar.getCookies('https://login.sanoma.it');
    const csrfCookie = cookies.find(c => c.key === '_csrf');
    const csrfToken = $('input[name="_csrf"]').val() || (csrfCookie ? csrfCookie.value : '');
    
    const parsedUrl = new URL(authUrl);
    const state = parsedUrl.searchParams.get('state');
    if (!state) throw new Error('State parameter not found in Auth0 URL');

    const loginPayload = {
        client_id: clientId,
        redirect_uri: redirectUri,
        tenant: "sanoma-italy",
        response_type: "code",
        scope: "openid profile email",
        state,
        connection: "Sanoma-Italy-Database",
        username: email,
        password,
        popup_options: {},
        sso: true,
        protocol: "oauth2",
        _csrf: csrfToken,
        _intstate: "deprecated"
    };

    let loginRes;
    try {
        loginRes = await client.post('https://login.sanoma.it/usernamepassword/login', loginPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://login.sanoma.it',
                'Referer': authUrl,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
    } catch (err) {
        throw new Error(`Login failed: ${err.response?.status ?? 'Unknown'} ${err.response?.statusText ?? ''}`);
    }

    const $login = cheerio.load(loginRes.data);
    const wa      = $login('input[name="wa"]').val();
    const wresult = $login('input[name="wresult"]').val();
    const wctx    = $login('input[name="wctx"]').val();

    if (!wa || !wresult || !wctx) {
        throw new Error('Login failed: callback form not found (wrong credentials?)');
    }

    let finalCodeUrl = null;
    try {
        const callbackRes = await client.post(
            'https://login.sanoma.it/login/callback',
            `wa=${encodeURIComponent(wa)}&wresult=${encodeURIComponent(wresult)}&wctx=${encodeURIComponent(wctx)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://login.sanoma.it',
                    'Referer': 'https://login.sanoma.it/',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            }
        );
        if (callbackRes.status >= 300 && callbackRes.status < 400) {
            finalCodeUrl = callbackRes.headers.location;
        }
    } catch(err) {
        if (err.response?.status >= 300 && err.response?.status < 400) {
            finalCodeUrl = err.response.headers.location;
        } else {
            throw err;
        }
    }

    if (!finalCodeUrl) throw new Error('Final redirect URL not found after callback');

    if (!finalCodeUrl.startsWith('http')) {
        finalCodeUrl = finalCodeUrl.startsWith('/authorize')
            ? 'https://login.sanoma.it' + finalCodeUrl
            : 'https://place.sanoma.it' + (finalCodeUrl.startsWith('/') ? '' : '/') + finalCodeUrl;
    }
    
    let currentUrl = finalCodeUrl;
    for (let i = 0; i < 15; i++) {
        try {
            const res = await client.get(currentUrl, {
                headers: {
                    'Referer': i === 0 ? 'https://login.sanoma.it/' : currentUrl,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            if (res.status >= 300 && res.status < 400 && res.headers.location) {
                let next = res.headers.location;
                if (!next.startsWith('http')) next = next.startsWith('/authorize') ? 'https://login.sanoma.it' + next : 'https://place.sanoma.it' + next;
                currentUrl = next;
            } else {
                break;
            }
        } catch (err) {
            if (err.response?.status >= 300 && err.response?.status < 400) {
                let next = err.response.headers.location;
                if (!next.startsWith('http')) next = next.startsWith('/authorize') ? 'https://login.sanoma.it' + next : 'https://place.sanoma.it' + next;
                currentUrl = next;
            } else {
                break;
            }
        }
    }

    return client;
}

export async function fetchBooks(client) {
  const response = await client.get(PLACE_BOOKS_DATA_URL, {
    headers: {
      ...DEFAULT_HEADERS,
      'Referer': PLACE_BOOKS_PAGE_URL,
      'Accept': 'application/json',
      'X-Sveltekit-Invalidated': '01'
    }
  });

  const lines = response.data.split('\n').filter(line => line.trim());
  const jsonObjects = lines.map(line => JSON.parse(line));

  let allData = [];
  
  jsonObjects.forEach(obj => {
    if (obj.data && Array.isArray(obj.data)) {
        for (let i = 0; i < obj.data.length; i++) {
            if (obj.data[i] !== undefined) allData[i] = obj.data[i];
        }
    }
    if (obj.nodes) {
      obj.nodes.forEach(node => {
        if (node && Array.isArray(node.data)) {
          for (let i = 0; i < node.data.length; i++) {
              if (node.data[i] !== undefined) allData[i] = node.data[i];
          }
        }
      });
    }
  });

  jsonObjects.filter(obj => obj.type === 'chunk' && obj.data).forEach(chunk => {
    let chunkData = chunk.data;
    if (Array.isArray(chunkData[0])) chunkData = chunkData[0];
    for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] !== undefined) allData[i] = chunkData[i];
    }
  });
  
  const books = [];
  const seenOperas = new Set();
  const resolved = new Map();

  function decompressValue(val) {
      if (typeof val === 'number') {
          if (val < 0 || val >= allData.length || allData[val] === undefined) return val;
          if (resolved.has(val)) return resolved.get(val);
          const target = allData[val];
          if (Array.isArray(target)) {
              const newArr = [];
              resolved.set(val, newArr);
              for (let j = 0; j < target.length; j++) newArr.push(decompressValue(target[j]));
              return newArr;
          } else if (target && typeof target === 'object') {
              const newObj = {};
              resolved.set(val, newObj);
              for (const key in target) newObj[key] = decompressValue(target[key]);
              return newObj;
          } else {
              resolved.set(val, target);
              return target;
          }
      }
      return val;
  }

  for (let i = 0; i < allData.length; i++) {
    const item = allData[i];
    
    if (item && typeof item === 'object' && !Array.isArray(item) && 'opera_id' in item && 'display_name' in item) {
        const fullyResolved = decompressValue(i);
        if (!fullyResolved || !fullyResolved.opera_id || seenOperas.has(fullyResolved.opera_id)) continue;
        seenOperas.add(fullyResolved.opera_id);
        
        const productsMap = new Map();
        const crawlVisited = new Set();
        
        function extractProducts(node, namePath, inheritedIsbn) {
            if (!node || typeof node !== 'object') return;
            if (crawlVisited.has(node)) return;
            crawlVisited.add(node);
            
            let currentNames = [...namePath];
            const potentialNames = [node.display_name, node.title, node.name, node.category_label, node.category_name];
            
            for (const n of potentialNames) {
                const str = String(n || '').trim();
                if (str && str !== 'Prodotti' && str !== 'null' && str !== 'undefined' && str !== '[object Object]' && !/^\d+$/.test(str)) {
                    let isRedundant = false;
                    for (let j = 0; j < currentNames.length; j++) {
                        const existing = currentNames[j];
                        if (existing.toLowerCase() === str.toLowerCase()) { isRedundant = true; break; }
                        if (str.toLowerCase().includes(existing.toLowerCase()) && str.length > existing.length) { currentNames[j] = str; isRedundant = true; break; }
                        if (existing.toLowerCase().includes(str.toLowerCase())) { isRedundant = true; break; }
                    }
                    if (!isRedundant) currentNames.push(str);
                }
            }
            
            const currentIsbn = node.isbn || node.paper_isbn || inheritedIsbn;
            let gediCode = null;
            if (node.external_id && /^\d{5,10}$/.test(String(node.external_id))) gediCode = String(node.external_id);
            else if (node.id && /^\d{5,10}$/.test(String(node.id))) gediCode = String(node.id);
            
            if (gediCode) {
                let finalParts = [];
                for (let j = 0; j < currentNames.length; j++) {
                    let isRedundant = false;
                    let currFirstWord = currentNames[j].trim().split(/[\s\-_]+/)[0].toLowerCase();
                    for (let k = j + 1; k < currentNames.length; k++) {
                        let nextFirstWord = currentNames[k].trim().split(/[\s\-_]+/)[0].toLowerCase();
                        if (currFirstWord && currFirstWord === nextFirstWord) { isRedundant = true; break; }
                    }
                    if (!isRedundant) finalParts.push(currentNames[j]);
                }
                let finalName = finalParts.join(' - ') || `Volume (${gediCode})`;
                
                if (!productsMap.has(gediCode)) {
                    productsMap.set(gediCode, { isbn: currentIsbn || '', name: finalName, gedi: gediCode, resources: [] });
                } else if (finalName.length > productsMap.get(gediCode).name.length) {
                    productsMap.get(gediCode).name = finalName;
                }
                
                productsMap.get(gediCode).resources.push({
                    type: node.category_name || '',
                    category_id: node.category_id || '',
                    external_id: node.external_id || '',
                    code: node.internal_code || '',
                    url: node.url || ''
                });
            }
            
            if (Array.isArray(node)) {
                for (let k = 0; k < node.length; k++) {
                    if (typeof node[k] === 'object') extractProducts(node[k], currentNames, currentIsbn);
                }
            } else {
                for (const key in node) {
                    if (typeof node[key] === 'object') extractProducts(node[key], currentNames, currentIsbn);
                }
            }
        }
        
        let initialPath = [];
        if (fullyResolved.display_name) initialPath.push(fullyResolved.display_name);
        extractProducts(fullyResolved.included || fullyResolved, initialPath, '');
        
        for (const product of productsMap.values()) {
            books.push({ name: product.name, opera_id: fullyResolved.opera_id, products: [product] });
        }
    }
  }

  return books;
}

function normalizePlaceBookUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return `https://place.sanoma.it${url}`;
    return `https://place.sanoma.it/${url}`;
}

function getProductPlaceUrl(product) {
    const candidates = [
        product?.url,
        ...(Array.isArray(product?.resources) ? product.resources.map((resource) => resource?.url) : [])
    ];

    for (const candidate of candidates) {
        const normalized = normalizePlaceBookUrl(candidate);
        if (normalized && normalized.includes('/prodotti_digitali/')) {
            return normalized;
        }
    }

    return null;
}

function getAllProducts(books) {
    const products = [];
    for (const book of books) {
        for (const product of book.products || []) {
            products.push(product);
        }
    }
    return products;
}

export async function getBookCatalog(client) {
    const books = await fetchBooks(client);
    const products = getAllProducts(books);

    return products.map((product) => ({
        ...product,
        placeUrl: getProductPlaceUrl(product)
    }));
}

export async function getBookMetadata(client, gedi) {
    const products = await getBookCatalog(client);
    const product = products.find((entry) => String(entry.gedi) === String(gedi));

    if (!product) {
        throw new Error(`Libro con GEDI ${gedi} non trovato nella libreria Sanoma.`);
    }

    return product;
}

export async function fetchKToken(client, placeUrl) {
    const normalizedPlaceUrl = normalizePlaceBookUrl(placeUrl);
    if (!normalizedPlaceUrl) {
        throw new Error('URL del libro Sanoma non valido o mancante.');
    }

    let response;
    try {
        response = await client.get(normalizedPlaceUrl, {
            headers: {
                ...DEFAULT_HEADERS,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': PLACE_BOOKS_PAGE_URL
            }
        });
    } catch (err) {
        if (err.response) {
            response = err.response;
        } else {
            throw err;
        }
    }

    const location = response.headers?.location;
    if (!location) {
        throw new Error(`Redirect verso open-book non trovato per ${normalizedPlaceUrl}.`);
    }

    const redirectUrl = new URL(location, normalizedPlaceUrl);
    const ktoken = redirectUrl.searchParams.get('ktoken');

    if (!ktoken) {
        throw new Error(`ktoken non trovato nel redirect di ${normalizedPlaceUrl}.`);
    }

    return ktoken;
}

export async function fetchBookAccess(client, gedi, placeUrl) {
    const product = placeUrl
        ? { gedi, placeUrl: normalizePlaceBookUrl(placeUrl) }
        : await getBookMetadata(client, gedi);

    if (!product.placeUrl) {
        throw new Error(`URL place.sanoma.it non trovato per il libro GEDI ${gedi}.`);
    }

    const xAuthToken = await fetchKToken(client, product.placeUrl);
    const response = await client.get(DISPLAY_BOOKS_URL, {
        headers: {
            ...DEFAULT_HEADERS,
            'Accept': 'application/json, text/plain, */*',
            'Referer': `${EBOOK_ORIGIN}/`,
            'Origin': EBOOK_ORIGIN,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'Sec-GPC': '1',
            'TE': 'trailers',
            'X-Auth-Token': xAuthToken
        }
    });

    const payload = response.data;
    const firstEntry = Array.isArray(payload?.data) ? payload.data[0] : null;
    const bookData = firstEntry?.book || payload?.book || payload?.data?.book || null;
    const resolvedGedi = firstEntry?.gedi || payload?.gedi || gedi;
    const cookies = bookData?.cookies || {};

    const cookieKeys = ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'];
    const missingKeys = cookieKeys.filter((key) => !cookies[key]);
    if (!bookData?.url || missingKeys.length > 0) {
        throw new Error(`Risposta display-books incompleta per GEDI ${gedi}.`);
    }

    return {
        gedi: String(resolvedGedi),
        placeUrl: product.placeUrl,
        xAuthToken,
        baseUrl: String(bookData.url).replace(/\/$/, ''),
        cookies,
        cookieHeader: cookieKeys.map((key) => `${key}=${cookies[key]}`).join('; ')
    };
}

export async function fetchCloudfrontCookies(client, gedi, placeUrl) {
    const access = await fetchBookAccess(client, gedi, placeUrl);
    return access.cookieHeader;
}
