const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const MYINSTANTS_BASE = 'https://www.myinstants.com';
const MYINSTANTS_SEARCH = `${MYINSTANTS_BASE}/search/?name=`;
const MYINSTANTS_CATEGORIES = `${MYINSTANTS_BASE}/en/categories/`;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 50;

let mainWindow = null;
const registeredShortcuts = new Map();
const soundShortcutMap = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#111111',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      enableRemoteModule: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => sendToRenderer('window-maximized', { maximized: true }));
  mainWindow.on('unmaximize', () => sendToRenderer('window-maximized', { maximized: false }));
}

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function safeFilename(value) {
  return String(value || 'sound')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'sound';
}

function extractMp3Url(onclickValue) {
  const match = String(onclickValue || '').match(/['"]([^'"]+\.mp3[^'"]*)['"]/);
  if (!match) {
    return '';
  }

  return new URL(match[1], MYINSTANTS_BASE).toString();
}

function detectCountryCode() {
  try {
    if (typeof app.getLocaleCountryCode === 'function') {
      const localeCountryCode = app.getLocaleCountryCode();
      if (localeCountryCode) {
        return String(localeCountryCode).toLowerCase();
      }
    }
  } catch (error) {
    console.warn('Unable to determine locale country code:', error);
  }

  const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  const localeMatch = locale.match(/[-_](?<region>[A-Za-z]{2}|\d{3})$/);

  if (localeMatch?.groups?.region) {
    return localeMatch.groups.region.toLowerCase();
  }

  return 'id';
}

function buildTrendingUrls(countryCode) {
  const normalizedCountry = String(countryCode || 'id').toLowerCase();
  return [
    `${MYINSTANTS_BASE}/en/index/${normalizedCountry}/`,
    `${MYINSTANTS_BASE}/en/trending/`,
  ];
}

function buildCategoryUrls(categorySlug, countryCode) {
  const normalizedCountry = String(countryCode || 'id').toLowerCase();
  const slug = String(categorySlug || '').replace(/^\/+|\/+$/g, '');

  return [
    `${MYINSTANTS_BASE}/en/categories/${slug}/${normalizedCountry}/`,
    `${MYINSTANTS_BASE}/en/categories/${slug}/`,
  ];
}

function parseInstantResults($) {
  const results = [];
  const seenUrls = new Set();

  const instantCards = $('.instant');

  if (instantCards.length > 0) {
    instantCards.each((_, element) => {
      const instant = $(element);
      const name = instant.find('a.instant-link').text().trim() || 'Unbekannt';
      const onclickValue = instant.find('button.small-button').attr('onclick') || instant.find('button[onclick]').attr('onclick') || '';
      const mp3Url = extractMp3Url(onclickValue);

      if (mp3Url && !seenUrls.has(mp3Url)) {
        seenUrls.add(mp3Url);
        results.push({
          name,
          mp3_url: mp3Url,
        });
      }
    });

    return results;
  }

  $('a[href*="/en/instant/"]').each((_, link) => {
    const anchor = $(link);
    const name = anchor.text().trim();

    if (!name) {
      return;
    }

    const container = anchor.closest('div, article, li, section');
    const onclickValue = container.find('button.small-button').attr('onclick') || container.find('button[onclick]').attr('onclick') || '';
    const mp3Url = extractMp3Url(onclickValue);

    if (mp3Url && !seenUrls.has(mp3Url)) {
      seenUrls.add(mp3Url);
      results.push({
        name,
        mp3_url: mp3Url,
      });
    }
  });

  return results;
}

function clampMaxPages(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_PAGES;
  }

  return Math.min(Math.floor(parsed), MAX_PAGES_CAP);
}

function buildPagedUrl(baseUrl, page) {
  if (page <= 1) {
    return baseUrl;
  }

  const joiner = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${joiner}page=${page}`;
}

async function fetchPagedResults(baseUrl, maxPages) {
  const results = [];
  const seen = new Set();
  const totalPages = clampMaxPages(maxPages);

  for (let page = 1; page <= totalPages; page += 1) {
    const pageUrl = buildPagedUrl(baseUrl, page);
    const response = await fetch(pageUrl);

    if (!response.ok) {
      if (page === 1) {
        throw new Error(`Request failed for ${pageUrl} with status ${response.status}`);
      }
      break;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const pageResults = parseInstantResults($) || [];

    let added = 0;
    for (const item of pageResults) {
      if (!item || !item.mp3_url) continue;
      if (seen.has(item.mp3_url)) continue;
      seen.add(item.mp3_url);
      results.push(item);
      added += 1;
    }

    if (added === 0) {
      break;
    }
  }

  return results;
}

async function fetchPagedResultsFromUrls(urls, maxPages) {
  let lastError = null;

  for (const url of urls) {
    try {
      const results = await fetchPagedResults(url, maxPages);

      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchHtmlFromUrls(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        lastError = new Error(`Request failed for ${url} with status ${response.status}`);
        continue;
      }

      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to fetch MyInstants page');
}

async function getCategories() {
  const response = await fetch(MYINSTANTS_CATEGORIES);

  if (!response.ok) {
    throw new Error(`Categories request failed with status ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const categories = [];
  const seenSlugs = new Set();

  $('a[href*="/en/categories/"]').each((_, link) => {
    const anchor = $(link);
    const href = anchor.attr('href') || '';
    const label = anchor.text().trim();

    if (!label || !href) {
      return;
    }

    const parsedUrl = new URL(href, MYINSTANTS_BASE);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    const slugSegment = pathParts[2] || '';

    if (!slugSegment || slugSegment === 'categories' || !parsedUrl.pathname.includes('/en/categories/')) {
      return;
    }

    if (!/\/en\/categories\/.+\/$/.test(parsedUrl.pathname)) {
      return;
    }

    if (seenSlugs.has(slugSegment)) {
      return;
    }

    seenSlugs.add(slugSegment);
    categories.push({
      label,
      slug: slugSegment,
    });
  });

  return categories;
}

async function searchMyinstants(searchTerm, maxPages = DEFAULT_MAX_PAGES) {
  const baseUrl = `${MYINSTANTS_SEARCH}${encodeURIComponent(searchTerm.trim())}`;
  return fetchPagedResults(baseUrl, maxPages);
}

async function getTrendingSounds(countryCode, maxPages = DEFAULT_MAX_PAGES) {
  return fetchPagedResultsFromUrls(buildTrendingUrls(countryCode), maxPages);
}

async function getCategorySounds(categorySlug, countryCode, maxPages = DEFAULT_MAX_PAGES) {
  return fetchPagedResultsFromUrls(buildCategoryUrls(categorySlug, countryCode), maxPages);
}

async function downloadSound(url, filename) {
  const downloadsDir = path.join(app.getPath('downloads'), 'Soundboard');
  fs.mkdirSync(downloadsDir, { recursive: true });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const safeName = safeFilename(filename || path.parse(new URL(url).pathname).name || 'sound');
  const outputPath = path.join(downloadsDir, safeName.toLowerCase().endsWith('.mp3') ? safeName : `${safeName}.mp3`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

function registerShortcut(accelerator, soundId) {
  if (soundId) {
    const previousAccelerator = soundShortcutMap.get(soundId);
    if (previousAccelerator && previousAccelerator !== accelerator) {
      globalShortcut.unregister(previousAccelerator);
      registeredShortcuts.delete(previousAccelerator);
    }
  }

  const existing = registeredShortcuts.get(accelerator);

  if (existing) {
    globalShortcut.unregister(accelerator);
    registeredShortcuts.delete(accelerator);
  }

  const registered = globalShortcut.register(accelerator, () => {
    const shortcutEvent = {
      accelerator,
      soundId: soundId || null,
      triggeredAt: Date.now(),
    };

    sendToRenderer('play-sound', shortcutEvent);
    sendToRenderer('shortcut-triggered', shortcutEvent);
  });

  if (registered) {
    registeredShortcuts.set(accelerator, soundId || null);
    if (soundId) {
      soundShortcutMap.set(soundId, accelerator);
    }
  }

  return registered;
}

function unregisterShortcutForSound(soundId) {
  const previousAccelerator = soundShortcutMap.get(soundId);

  if (!previousAccelerator) {
    return false;
  }

  globalShortcut.unregister(previousAccelerator);
  registeredShortcuts.delete(previousAccelerator);
  soundShortcutMap.delete(soundId);
  return true;
}

ipcMain.handle('search-myinstants', async (_event, searchTerm, options = {}) => {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return [];
  }

  const maxPages = clampMaxPages(options?.maxPages);
  return searchMyinstants(searchTerm, maxPages);
});

ipcMain.handle('get-myinstants-context', async () => ({
  countryCode: detectCountryCode(),
  categories: await getCategories(),
}));

ipcMain.handle('get-myinstants-trending', async (_event, payload = {}) => {
  const countryCode = payload.countryCode || detectCountryCode();
  const maxPages = clampMaxPages(payload?.maxPages);
  return getTrendingSounds(countryCode, maxPages);
});

ipcMain.handle('get-myinstants-category', async (_event, payload = {}) => {
  const categorySlug = payload.categorySlug || '';
  const countryCode = payload.countryCode || detectCountryCode();

  if (!categorySlug) {
    return [];
  }

  const maxPages = clampMaxPages(payload?.maxPages);
  return getCategorySounds(categorySlug, countryCode, maxPages);
});

ipcMain.handle('download-sound', async (_event, payload = {}) => {
  const { url, filename } = payload;

  if (!url) {
    throw new Error('Missing url');
  }

  const savedTo = await downloadSound(url, filename);
  return { saved_to: savedTo };
});

ipcMain.on('register-shortcut', (event, shortcutConfig = {}) => {
  const { accelerator, soundId } = shortcutConfig;

  if (!soundId || typeof soundId !== 'string') {
    event.reply('register-shortcut-response', {
      ok: false,
      error: 'Missing sound id',
    });
    return;
  }

  if (!accelerator || typeof accelerator !== 'string') {
    const cleared = unregisterShortcutForSound(soundId);

    event.reply('register-shortcut-response', {
      ok: cleared,
      cleared: true,
      accelerator: '',
      soundId,
    });
    return;
  }

  const ok = registerShortcut(accelerator, typeof soundId === 'string' ? soundId : null);

  event.reply('register-shortcut-response', {
    ok,
    accelerator,
    soundId: typeof soundId === 'string' ? soundId : null,
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  registeredShortcuts.clear();
  soundShortcutMap.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});