import yargs from 'yargs';
import PromptSync from 'prompt-sync';
import fetch from 'node-fetch';
import yauzl from 'yauzl';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream';
import { loginSanoma, fetchBooks } from './src/sanoma/auth.js';

const prompt = PromptSync({ sigint: true });
const SANOMA_BASE_URLS = [
  process.env.SANOMA_API_BASE,
  'https://npmoffline.sanoma.it/mcs/api/v1',
  'https://npmoffline.sanoma.it/api/v1',
].filter(Boolean);

export async function run(options = {}) {
  const argv = yargs(process.argv.slice(2))
    .option('id', {
      alias: 'i',
      type: 'string',
      description: 'user id (email)',
    })
    .option('password', {
      alias: 'p',
      type: 'string',
      description: 'user password',
    })
    .option('gedi', {
      alias: 'g',
      type: 'string',
      description: 'book\'s gedi',
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output file',
    })
    .option('download', {
      type: 'boolean',
      description: 'Download the book',
      default: true,
      hidden: true,
    })
    .option('no-download', {
      type: 'boolean',
      description: 'Skip downloading the book and try to extract the zip file that is already in the temp folder',
      default: false,
    })
    .option('clean', {
      type: 'boolean',
      description: 'Clean up the temp folder after finishing',
      default: true,
      hidden: true,
    })
    .option('no-clean', {
      type: 'boolean',
      description: 'Don\'t clean up the temp folder after finishing',
      default: false,
    })
    .option('ocr', {
      type: 'string',
      description: 'Run OCR on output (on/off)',
      default: null,
    })
    .help()
    .argv;

  const {
    id,
    password,
    gedi,
    ocr,
  } = options;

  console.log("Avvio provider Sanoma...");

  const sessionTmp = process.env.OURBOOKS_SESSION_TMP || 'tmp';
  const outputDir = process.env.OURBOOKS_OUTPUT_DIR || '.';
  const doOcr = (ocr || argv.ocr) === 'on';

  await fsExtra.ensureDir(sessionTmp);

  let userId = id || argv.id;
  let userPassword = password || argv.password;
  let bookGedi = gedi || argv.gedi;

  function promisify(api) {
    return function (...args) {
        return new Promise((resolve, reject) => {
        api(...args, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
        });
    };
  }

  const yauzlFromFile = promisify(yauzl.open);

  function runOCR(inputPdf, outputPdf) {
    return new Promise((resolve, reject) => {
        const ocr = spawn('ocrmypdf', [inputPdf, outputPdf], { stdio: 'inherit' });

      ocr.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ocrmypdf non trovato. Installa ocrmypdf oppure usa il PDF senza OCR.'));
        return;
      }
      reject(err);
      });

        ocr.on('close', (code) => {
        if (code === 0) resolve();
      else reject(new Error(`OCRmyPDF exited with code ${code}`));
        });
    });
  }

  async function fetchSanomaJson(pathname, init = {}) {
    let lastError = null;

    for (const base of SANOMA_BASE_URLS) {
      const url = `${base}${pathname}`;
      try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.message || data?.error || `HTTP ${res.status}`;
        throw new Error(`${url}: ${message}`);
      }
      return data;
      } catch (err) {
      lastError = err;
      }
    }

    throw lastError || new Error('Richiesta Sanoma fallita');
  }

  function getAccessToken(userAuth) {
    return userAuth?.result?.data?.access_token
      || userAuth?.data?.access_token
      || userAuth?.access_token
      || userAuth?.token
      || null;
  }

  function getBooksPage(payload) {
    const data = payload?.result?.data || payload?.data || payload?.books || [];
    const totalSize = payload?.result?.total_size ?? payload?.total_size ?? payload?.total ?? data.length;
    const rawPageSize = payload?.result?.page_size ?? payload?.page_size ?? data.length;
    const pageSize = rawPageSize || 1;
    return {
      data: Array.isArray(data) ? data : [],
      pages: Math.max(1, Math.ceil(totalSize / pageSize)),
    };
  }

  function getBookName(book) {
    return book?.name || book?.title || `GEDI ${book?.gedi || ''}`.trim();
  }

  function getBookDownloadUrl(book) {
    return book?.url_download || book?.urlDownload || book?.downloadUrl || book?.url || null;
  }

  (async () => {
    await fsExtra.ensureDir(sessionTmp);

    let targetBookName = "Sanoma Book";

    if (argv.download) {
        let folder = await fs.promises.readdir(sessionTmp);
        if (folder.length > 0) {
        console.log('Temp folder is not empty, delete tmp folder to download the book');
        process.exit(1);
        }

        let loginId = userId;
        let loginPassword = userPassword;

        console.log('Warning: this script might log you out of other devices');

        while (!loginId) loginId = prompt('Enter account email: ');
        while (!loginPassword) loginPassword = prompt('Enter account password: ', { echo: '*' });

        console.log('Logging in to MyPlace to retrieve books...');
        const skClient = await loginSanoma(loginId, loginPassword).catch(err => {
            console.error('Failed to log in via MyPlace:', err.message);
            process.exit(1);
        });

        console.log('Fetching book list...');
        const skBooks = await fetchBooks(skClient);

        let tableObj = {};
        for (const b of skBooks) {
           for (const p of b.products) {
              tableObj[p.gedi] = p.name;
           }
        }
        
        console.log('Books (MyPlace graph):');
        console.table(tableObj);

        let gedi = bookGedi;
        while (!gedi) gedi = prompt('Enter the book\'s gedi: ');

        targetBookName = tableObj[gedi] || `GEDI ${gedi}`;

        console.log('Logging in to offline API to retrieve download URL...');
        let userAuth = await fetchSanomaJson('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Timezone-Offset': '+0200' },
        body: JSON.stringify({ id: loginId, password: loginPassword }),
        }).catch((err) => { console.error('Failed to log in:', err.message); process.exit(1); });

        if (!userAuth || (userAuth.code != null && userAuth.code !== 0)) {
        console.error('Failed to log in', userAuth?.message || 'Unknown error');
        process.exit(1);
        }

        const accessToken = getAccessToken(userAuth);
        if (!accessToken) {
        console.error('Login riuscito ma token accesso non trovato nella risposta API.');
        process.exit(1);
        }

        console.log('Searching for download bundle...');
        let downloadUrl = null;
        let pages = 1;
        for (let i = 1; i <= pages; i++) {
        const newBooks = await fetchSanomaJson(`/books?app=true&page=${i}`, {
          headers: { 'X-Auth-Token': 'Bearer ' + accessToken },
        }).catch((err) => { console.error('Errore recupero libri:', err.message); process.exit(1); });

        const pageInfo = getBooksPage(newBooks);
        pages = pageInfo.pages;

        for (const item of pageInfo.data) {
          if (item?.gedi == gedi) {
            downloadUrl = getBookDownloadUrl(item);
            break;
          }
        }
        if (downloadUrl) break;
        }

        if (!downloadUrl) {
        console.error(`URL download non trovato per questo GEDI (${gedi}) nella offline API. Errore bundle non disponibile.`);
        process.exit(1);
        }

        console.log('Downloading "' + targetBookName + '"');

        let zip = await fetch(downloadUrl);
        if (!zip.ok) { console.error('Failed to download zip'); process.exit(1); }

        const totalBytes = parseInt(zip.headers.get('content-length'), 10);
        let downloadedBytes = 0;
        let lastLoggedPercent = 0;

        zip.body.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes) {
                const percent = Math.floor((downloadedBytes / totalBytes) * 100);
                if (percent >= lastLoggedPercent + 10) {
                    process.stdout.write(`...${percent}%`);
                    lastLoggedPercent = percent;
                }
            }
        });

        await promisify(pipeline)(zip.body, fs.createWriteStream(sessionTmp + '/book.zip'));
        console.log('\nDownload completato!');
    } else {
        console.log('Skipping download');
        let stats = await fs.promises.stat(sessionTmp + '/book.zip');
        if (!stats.isFile()) { console.error('No zip file found in tmp'); process.exit(1); }
    }

    console.log('Extracting zip');

    let zipFile = await yauzlFromFile(sessionTmp + '/book.zip');
    let openReadStream = promisify(zipFile.openReadStream.bind(zipFile));

    zipFile.on('entry', async (entry) => {
        if (!entry.fileName.startsWith("pages") || entry.fileName.endsWith('/')) return;
        let filePath = entry.fileName.slice(5);
        let folder = path.dirname(filePath);
        await fsExtra.ensureDir(`${sessionTmp}/pages/${folder}`);
        let page = await openReadStream(entry);
        let file = fs.createWriteStream(`${sessionTmp}/pages/${filePath}`);
        page.pipe(file);
    });

    zipFile.on('end', async () => {
        await fs.promises.mkdir(sessionTmp + '/output', { recursive: true });
        let folders = (await fs.promises.readdir(sessionTmp + '/pages')).filter(file => /^\d+$/g.test(file));
        let total = folders.length;

        for (let i = 0; i < total; i++) {
        console.log('Converting page ' + (i + 1) + ' of ' + total);
        await convertPage(`${sessionTmp}/pages/${i+1}/${i+1}.svg`, `${sessionTmp}/output/${i+1}.pdf`);
        }

        console.log('Merging pages');

        let pdf = await PDFDocument.create();
        for (let i = 0; i < total; i++) {
        let file = await fs.promises.readFile(`${sessionTmp}/output/${i+1}.pdf`);
        let page = await PDFDocument.load(file);
        let [copiedPage] = await pdf.copyPages(page, [0]);
        pdf.addPage(copiedPage);
        }

        let baseName = argv.output || options.output;
        if (argv.download && !baseName) baseName = targetBookName.replace(/[\\/:*?"<>|]/g, '') + '.pdf';
        else if (!baseName) baseName = 'output.pdf';
        const outFilePath = path.join(outputDir, baseName);

        console.log('Saving PDF (image only)...');
        await fs.promises.writeFile(outFilePath, await pdf.save());

        let finalOutput = outFilePath;
        if (doOcr) {
        console.log('Running OCR to make text selectable...');
        const ocrPath = path.join(outputDir, 'ocr_' + baseName);
        try {
          await runOCR(outFilePath, ocrPath);
          finalOutput = ocrPath;
        } catch (ocrError) {
          console.warn('OCR saltato:', ocrError.message);
        }
        }

        if (argv.clean) {
        console.log('Cleaning up');
        await fsExtra.remove(sessionTmp);
        } else {
        console.log('Skipping clean up, delete tmp when done');
        }

        console.log('Done. Output:', finalOutput);
        console.log(`OURBOOKS_OUTPUT:${finalOutput}`);
    });
  })();

  async function convertPage(input, output) {
    try {
      await convertPageWithInkscape(input, output);
    } catch (err) {
      console.error('Inkscape fallito:', err.message);
      throw err;
    }
  }

  async function convertPageWithInkscape(input, output) {
    return new Promise((resolve, reject) => {
      const convert = spawn('inkscape', ['--export-filename=' + output, input]);
      convert.on('error', reject);
      convert.on('close', code => code === 0 ? resolve() : reject(new Error(`Inkscape exited with code ${code}`)));
    });
  }
}

export async function login(username, password) {
  try {
    const skClient = await loginSanoma(username, password);
    return { id: username, password };
  } catch (err) {
    throw new Error('SvelteKit Auth failed: ' + err.message);
  }
}

export async function getBooks(session) {
  const { id, password } = session;
  const skClient = await loginSanoma(id, password);
  const rawBooks = await fetchBooks(skClient);

  const booksMap = new Map();

  for (const b of rawBooks) {
    const rootName = b.products[0]?.name.split(' - ')[0] || 'Unknown Root';
    const operaId = b.opera_id;
    
    if (!booksMap.has(operaId)) {
        booksMap.set(operaId, {
            id: operaId,
            name: rootName,
            products: []
        });
    }

    const prod = b.products[0];
    booksMap.get(operaId).products.push({
        id: prod.gedi,
        name: prod.name
    });
  }

  return Array.from(booksMap.values());
}