import yargs from 'yargs';
import PromptSync from 'prompt-sync';
import fetch from 'node-fetch';
import yauzl from 'yauzl';
import { PDFDocument } from 'pdf-lib';
import PDFKit from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream';

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

    if (!userId) userId = prompt("Enter account email: ");
    if (!userPassword) userPassword = prompt("Enter account password: ", { echo: '*' });

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

    let book;

    if (argv.download) {
        let folder = await fs.promises.readdir(sessionTmp);
        if (folder.length > 0) {
        console.log('Temp folder is not empty, delete tmp folder to download the book');
        process.exit(1);
        }

        let id = userId;
        let password = userPassword;

        console.log('Warning: this script might log you out of other devices');

        while (!id) id = prompt('Enter account email: ');
        while (!password) password = prompt('Enter account password: ', { echo: '*' });

        let userAuth = await fetchSanomaJson('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Timezone-Offset': '+0200' },
        body: JSON.stringify({ id, password }),
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

        console.log('Fetching book list');
        let books = {};
        let pages = 1;
        for (let i = 1; i <= pages; i++) {
        const newBooks = await fetchSanomaJson(`/books?app=true&page=${i}`, {
          headers: { 'X-Auth-Token': 'Bearer ' + accessToken },
        }).catch((err) => { console.error('Errore recupero libri:', err.message); process.exit(1); });

        const pageInfo = getBooksPage(newBooks);
        pages = pageInfo.pages;

        for (const item of pageInfo.data) {
          if (!item?.gedi) continue;
          books[item.gedi] = item;
        }
        }

        console.log('Books:');
        console.table(Object.fromEntries(Object.entries(books).map(([bookId, book]) => [bookId, getBookName(book)])));

        let gedi = bookGedi;
        while (!gedi) gedi = prompt('Enter the book\'s gedi: ');

        book = books[gedi];
        if (!book) {
        console.error(`GEDI non trovato: ${gedi}`);
        process.exit(1);
        }

        const downloadUrl = getBookDownloadUrl(book);
        if (!downloadUrl) {
        console.error('URL download non trovato nel payload del libro.');
        process.exit(1);
        }

        console.log('Downloading "' + getBookName(book) + '"');

        let zip = await fetch(downloadUrl);
        if (!zip.ok) { console.error('Failed to download zip'); process.exit(1); }

        await promisify(pipeline)(zip.body, fs.createWriteStream(sessionTmp + '/book.zip'));
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
        if (argv.download && !baseName) baseName = getBookName(book).replace(/[\\/:*?"<>|]/g, '') + '.pdf';
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
      if (err?.code !== 'ENOENT' && !String(err?.message || '').includes('inkscape non trovato')) {
      throw err;
      }

      console.warn('inkscape non trovato, uso fallback PDFKit per la conversione SVG.');
      await convertPageWithPdfKit(input, output);
    }
    }

    async function convertPageWithInkscape(input, output) {
    return new Promise((resolve, reject) => {
      const convert = spawn('inkscape', ['--export-filename=' + output, input]);
      convert.on('error', reject);
      convert.on('close', code => code === 0 ? resolve() : reject(new Error(`Inkscape exited with code ${code}`)));
    });
    }

    async function convertPageWithPdfKit(input, output) {
    let svg = await fs.promises.readFile(input, 'utf8');
    const svgDir = path.resolve(path.dirname(input));

    // Resolve relative image paths to absolute so PDFKit can find them
    svg = svg.replace(
      /((?:xlink:)?href)=(["'])(?!https?:\/\/|data:|(?:\/))([^"']+)\2/g,
      (_, attr, quote, relativePath) => {
        const abs = path.join(svgDir, relativePath);
        return `${attr}=${quote}${abs}${quote}`;
      }
    );

    const size = extractSvgSize(svg);

    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(output);
      const doc = new PDFKit({ autoFirstPage: false, margin: 0 });

      stream.on('finish', resolve);
      stream.on('error', reject);
      doc.on('error', reject);

      doc.pipe(stream);
      doc.addPage({ size: [size.width, size.height], margin: 0 });
      SVGtoPDF(doc, svg, 0, 0, {
      width: size.width,
      height: size.height,
      assumePt: true,
      preserveAspectRatio: 'xMinYMin meet',
      });
      doc.end();
    });
    }

    function extractSvgSize(svg) {
    const viewBox = svg.match(/viewBox=["']([^"']+)["']/i);
    if (viewBox) {
      const nums = viewBox[1].trim().split(/[\s,]+/).map(Number);
      if (nums.length === 4 && Number.isFinite(nums[2]) && Number.isFinite(nums[3])) {
      return { width: Math.max(1, nums[2]), height: Math.max(1, nums[3]) };
      }
    }

    const widthMatch = svg.match(/width=["']([\d.]+)(?:px)?["']/i);
    const heightMatch = svg.match(/height=["']([\d.]+)(?:px)?["']/i);
    const width = widthMatch ? Number(widthMatch[1]) : 595;
    const height = heightMatch ? Number(heightMatch[1]) : 842;
    return {
      width: Number.isFinite(width) && width > 0 ? width : 595,
      height: Number.isFinite(height) && height > 0 ? height : 842,
    };
    }
}