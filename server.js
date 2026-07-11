const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 8000);
const DATA_DIR = path.join(ROOT_DIR, '.data');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const MEDIA_DB_PATH = path.join(DATA_DIR, 'media-db.json');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_ALLOWED_EMAIL = (process.env.GOOGLE_ALLOWED_EMAIL || '').toLowerCase();
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'drevito_admin_session';
const OAUTH_STATE_COOKIE = 'drevito_oauth_state';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.arw': 'application/octet-stream'
};

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

const DEFAULT_SITE_IMAGE_TARGETS = [
  { key: 'hero', label: 'Úvodní fotka', url: '/main.JPG', alt: 'Dřevito dřevěné výrobky' },
  { key: 'about', label: 'Sekce o řemesle', url: '/prods.jpg', alt: 'Řemeslo s tradicí' },
  { key: 'author', label: 'Příběh autora', url: '/autor.JPG', alt: 'Autor Dřevito' },
  { key: 'custom_primary', label: 'Zakázková výroba 1', url: '/custom-service.jpg', alt: 'Zakázková výroba dřevěných výrobků' },
  { key: 'custom_secondary', label: 'Zakázková výroba 2', url: '/custom.JPG', alt: 'Ukázka zakázkové výroby' },
  { key: 'brand_logo', label: 'Logo', url: '/logo.jpg', alt: 'Dřevito' }
];

const DEFAULT_PRODUCT_IMAGE_TARGETS = [
  { key: 'P00002', label: 'Čajné stolicky', url: '/cajne-stolicky.JPG', alt: 'Čajné stolicky' },
  { key: 'P00016', label: 'Dekorační tabulka', url: '/dekoracni-tabulka.JPG', alt: 'Dekorační tabulka' },
  { key: 'P00004', label: 'Krabička', url: '/krabicka.JPG', alt: 'Krabička' },
  { key: 'P00020', label: 'Kůň', url: '/kun-dekorace.JPG', alt: 'Dřevěná dekorace koně' },
  { key: 'P00023', label: 'Dekorace žena', url: '/dekorace-zena.JPG', alt: 'Dekorace žena' },
  { key: 'P00018', label: 'Stojan na telefon', url: '/stojan-na-telefon.JPG', alt: 'Stojan na telefon' },
  { key: 'P00022', label: 'Hračka autíčko', url: '/hracka-auticko.JPG', alt: 'Hračka autíčko' }
];

const TARGET_TYPES = {
  site_sections: 'Sekce webu',
  products: 'Výrobky',
  blog_posts: 'Blog'
};

const MEDIA_BUCKETS = {
  site_sections: 'site-media',
  products: 'product-images',
  blog_posts: 'blog-images'
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createSignedPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signValue(body)}`;
}

function readSignedPayload(token) {
  if (!token || !token.includes('.')) return null;

  const dotIndex = token.lastIndexOf('.');
  const body = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  if (!safeEqual(signature, signValue(body))) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function createSession(email) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  return createSignedPayload({
    type: 'admin_session',
    email,
    expiresAt
  });
}

function getSession(req) {
  const cookie = parseCookies(req)[SESSION_COOKIE];
  const session = readSignedPayload(cookie);
  if (!session || session.type !== 'admin_session') return null;
  if (!session.email || session.expiresAt <= Date.now()) return null;
  return {
    id: cookie,
    email: String(session.email).toLowerCase(),
    expiresAt: session.expiresAt
  };
}

function createOauthState(next) {
  const safeNext = getSafeAdminNext(next);
  const state = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1000;
  return {
    state,
    next: safeNext,
    expiresAt,
    token: createSignedPayload({
      type: 'oauth_state',
      state,
      next: safeNext,
      expiresAt
    })
  };
}

function getOauthState(req, callbackState) {
  const payload = readSignedPayload(parseCookies(req)[OAUTH_STATE_COOKIE]);
  if (!payload || payload.type !== 'oauth_state') return null;
  if (!payload.state || !safeEqual(payload.state, callbackState)) return null;
  if (!payload.expiresAt || payload.expiresAt <= Date.now()) return null;
  return {
    state: payload.state,
    next: getSafeAdminNext(payload.next),
    expiresAt: payload.expiresAt
  };
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

function getBaseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL.replace(/\/+$/, '');
  const protocol = isHttps(req) ? 'https' : 'http';
  return `${protocol}://${req.headers.host || `localhost:${PORT}`}`;
}

function isAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_ALLOWED_EMAIL);
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function sessionCookie(value, req) {
  const secure = isHttps(req) || process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/admin',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function oauthStateCookie(value, req) {
  const secure = isHttps(req) || process.env.NODE_ENV === 'production';
  return [
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/admin',
    `Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`;
}

function expiredOauthStateCookie() {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`;
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, {
    Location: location,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end();
}

function slugify(value, fallback = 'image') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function legacyMediaId(url) {
  return `legacy-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createLegacyMedia(targetType, targetKey, targetLabel, image) {
  const id = legacyMediaId(`${targetType}:${targetKey}:${image.url}`);
  return {
    id,
    bucket: 'static',
    storage_path: image.url.replace(/^\/+/, ''),
    public_url: image.url,
    alt_text: image.alt || targetLabel,
    caption: '',
    mime_type: MIME_TYPES[path.extname(image.url).toLowerCase()] || 'image/jpeg',
    size_bytes: null,
    width: null,
    height: null,
    is_public: true,
    metadata: {
      source: 'static',
      target_type: targetType,
      target_key: targetKey
    },
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

function createPhotoRef(media, index) {
  return {
    media_id: media.id,
    url: media.public_url,
    alt: media.alt_text || '',
    caption: media.caption || '',
    sort_order: index,
    is_featured: index === 0
  };
}

function mediaBucketForTargetType(targetType) {
  const bucket = MEDIA_BUCKETS[targetType];
  if (!bucket) throw new Error('Unsupported media target.');
  return bucket;
}

function storagePathForPublicUrl(pathname) {
  return String(pathname || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function publicSupabaseStorageUrl(bucket, storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${storagePathForPublicUrl(storagePath)}`;
}

function ensureTargetWithKey(db, targetType, targetKey, targetLabel = '') {
  if (!TARGET_TYPES[targetType]) throw new Error('Unsupported media target.');
  const key = String(targetKey || '').trim();
  if (!key) return null;
  if (!db.targets[targetType]) db.targets[targetType] = {};
  if (!db.targets[targetType][key]) {
    db.targets[targetType][key] = {
      key,
      label: targetLabel || key,
      images: []
    };
  } else if (targetLabel) {
    db.targets[targetType][key].label = targetLabel;
  }
  return db.targets[targetType][key];
}

function createEmptyMediaDb() {
  return {
    version: 1,
    media: [],
    targets: {
      site_sections: {},
      products: {},
      blog_posts: {}
    }
  };
}

function ensureSeedTarget(db, targetType, target) {
  if (!db.targets[targetType]) db.targets[targetType] = {};
  if (db.targets[targetType][target.key]) return;

  const media = createLegacyMedia(targetType, target.key, target.label, target);
  db.media.push(media);
  db.targets[targetType][target.key] = {
    key: target.key,
    label: target.label,
    images: [createPhotoRef(media, 0)]
  };
}

function normalizeMediaDb(db) {
  const normalized = db && typeof db === 'object' ? db : createEmptyMediaDb();
  normalized.version = 1;
  normalized.media = Array.isArray(normalized.media) ? normalized.media : [];
  normalized.targets = normalized.targets && typeof normalized.targets === 'object'
    ? normalized.targets
    : {};
  normalized.targets.site_sections = normalized.targets.site_sections || {};
  normalized.targets.products = normalized.targets.products || {};
  normalized.targets.blog_posts = normalized.targets.blog_posts || {};

  DEFAULT_SITE_IMAGE_TARGETS.forEach((target) => ensureSeedTarget(normalized, 'site_sections', target));
  DEFAULT_PRODUCT_IMAGE_TARGETS.forEach((target) => ensureSeedTarget(normalized, 'products', target));
  return normalized;
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function readMediaDb() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(MEDIA_DB_PATH, 'utf8');
    return normalizeMediaDb(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Failed to read media database:', error);
    const db = normalizeMediaDb(createEmptyMediaDb());
    writeMediaDb(db);
    return db;
  }
}

function writeMediaDb(db) {
  ensureStorage();
  fs.writeFileSync(MEDIA_DB_PATH, `${JSON.stringify(normalizeMediaDb(db), null, 2)}\n`);
}

async function readSupabaseMediaDb() {
  const db = normalizeMediaDb(createEmptyMediaDb());
  const rows = await supabaseRequest('media', {
    query: {
      select: 'id,bucket,storage_path,public_url,alt_text,caption,mime_type,size_bytes,width,height,is_public,metadata,created_at,updated_at',
      order: 'created_at.asc'
    }
  });

  (Array.isArray(rows) ? rows : []).forEach((media) => {
    const metadata = media && media.metadata && typeof media.metadata === 'object' ? media.metadata : {};
    const targetType = String(metadata.target_type || metadata.targetType || '').trim();
    if (!TARGET_TYPES[targetType]) return;

    const targetKey = String(metadata.target_key || metadata.targetKey || '').trim();
    const targetLabel = String(metadata.target_label || metadata.targetLabel || targetKey).trim();
    const target = ensureTargetWithKey(db, targetType, targetKey, targetLabel);
    if (!target || media.is_public === false || !media.public_url) return;
    target.images = target.images.filter((image) => !String(image.media_id || '').startsWith('legacy-'));

    const sortOrder = Number(metadata.sort_order ?? metadata.sortOrder);
    const photo = createPhotoRef(media, Number.isFinite(sortOrder) ? sortOrder : target.images.length);
    photo.alt = String(photo.alt || metadata.alt || '').trim();
    photo.caption = String(photo.caption || metadata.caption || '').trim();
    photo.is_featured = metadata.is_featured === true || metadata.isFeatured === true;
    target.images.push(photo);
    db.media.push(media);
  });

  Object.values(db.targets).forEach((group) => {
    Object.values(group).forEach((target) => {
      if (!Array.isArray(target.images)) return;
      target.images.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      updateImageOrdering(target.images);
    });
  });

  return db;
}

async function getMediaDb() {
  return isSupabaseConfigured() ? readSupabaseMediaDb() : readMediaDb();
}

async function getPublicMediaTargets() {
  const db = await getMediaDb();
  return {
    site_sections: db.targets.site_sections,
    products: db.targets.products,
    blog_posts: db.targets.blog_posts
  };
}

function getTarget(db, targetType, targetKey, targetLabel = '') {
  if (!TARGET_TYPES[targetType]) throw new Error('Unsupported media target.');
  const rawKey = String(targetKey || targetLabel || '').trim();
  if (!rawKey) throw new Error('Vyberte položku nebo napište název nové položky.');
  const key = db.targets[targetType][rawKey] ? rawKey : slugify(rawKey, targetType);
  if (!db.targets[targetType][key]) {
    db.targets[targetType][key] = {
      key,
      label: targetLabel || key,
      images: []
    };
  } else if (targetLabel) {
    db.targets[targetType][key].label = targetLabel;
  }
  return db.targets[targetType][key];
}

function countMediaReferences(db, mediaId) {
  let count = 0;
  Object.values(db.targets).forEach((group) => {
    Object.values(group).forEach((target) => {
      if (!Array.isArray(target.images)) return;
      count += target.images.filter((image) => image.media_id === mediaId).length;
    });
  });
  return count;
}

function deleteLocalMediaFile(media) {
  if (!media || media.bucket !== 'local' || !media.storage_path) return;
  const filePath = path.resolve(ROOT_DIR, media.storage_path);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return;
  fs.unlink(filePath, (error) => {
    if (error && error.code !== 'ENOENT') console.error('Failed to delete upload:', error);
  });
}

async function deleteSupabaseMedia(media) {
  if (!media || !media.id || media.bucket === 'local' || media.bucket === 'static') return;
  await deleteSupabaseStorageObject(media);
  await supabaseRequest('media', {
    method: 'DELETE',
    query: {
      id: `eq.${media.id}`
    }
  });
}

async function deleteUnreferencedMedia(db, mediaId) {
  const media = db.media.find((entry) => entry.id === mediaId);
  if (!media || countMediaReferences(db, mediaId) !== 0) return;

  db.media = db.media.filter((entry) => entry.id !== mediaId);
  if (isSupabaseConfigured()) {
    await deleteSupabaseMedia(media);
  } else {
    deleteLocalMediaFile(media);
  }
}

function updateImageOrdering(images) {
  images.forEach((image, index) => {
    image.sort_order = index;
    image.is_featured = index === 0;
  });
}

function getRawBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Soubor je příliš velký.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseContentDisposition(value) {
  const result = {};
  String(value || '').split(';').forEach((part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rest.length) return;
    const key = rawKey.toLowerCase();
    result[key] = rest.join('=').replace(/^"|"$/g, '');
  });
  return result;
}

async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Chybí multipart boundary.');

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await getRawBody(req);
  const fields = {};
  const files = {};
  let cursor = body.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    let next = body.indexOf(boundary, cursor);
    if (next === -1) break;
    let part = body.slice(cursor, next);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('latin1');
      const content = part.slice(headerEnd + 4);
      const headers = {};
      headerText.split('\r\n').forEach((line) => {
        const separator = line.indexOf(':');
        if (separator === -1) return;
        headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
      });
      const disposition = parseContentDisposition(headers['content-disposition']);
      if (disposition.name) {
        if (disposition.filename) {
          files[disposition.name] = {
            filename: disposition.filename,
            mime_type: headers['content-type'] || 'application/octet-stream',
            buffer: content
          };
        } else {
          fields[disposition.name] = content.toString('utf8');
        }
      }
    }
    cursor = next;
  }

  return { fields, files };
}

function adminLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Dřevito</title>
  <link rel="icon" href="/favicon.ico?v=20260622-3" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f0e8;
      --panel: #fdfcfa;
      --ink: #3d2b1f;
      --muted: #6b5a4a;
      --accent: #c9a96e;
      --accent-dark: #ad8845;
      --line: rgba(61, 43, 31, 0.14);
      --shadow: 0 18px 45px rgba(61, 43, 31, 0.12);
      --font-display: 'Cormorant Garamond', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-body);
      line-height: 1.5;
    }
    a { color: inherit; }
    .shell {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px 16px;
    }
    .panel {
      width: min(100%, 980px);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 22px 28px;
      background: #2a1f16;
      color: var(--panel);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brand img {
      width: 52px;
      height: 52px;
      object-fit: contain;
      border-radius: 2px;
      background: var(--panel);
      flex: 0 0 auto;
    }
    .brand strong {
      display: block;
      font-family: var(--font-display);
      font-size: 1.55rem;
      font-weight: 600;
      line-height: 1;
    }
    .brand span {
      display: block;
      color: rgba(253, 252, 250, 0.7);
      font-size: 0.85rem;
      margin-top: 5px;
    }
    .content { padding: 32px 28px; }
    h1 {
      margin: 0 0 10px;
      font-family: var(--font-display);
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 600;
      line-height: 1.05;
    }
    p { margin: 0; color: var(--muted); }
    form { display: grid; gap: 18px; margin-top: 26px; }
    label { display: grid; gap: 8px; color: var(--ink); font-weight: 600; font-size: 0.9rem; }
    input,
    select,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }
    textarea {
      min-height: 86px;
      resize: vertical;
    }
    input[type="file"] {
      padding: 10px;
    }
    input:focus,
    select:focus,
    textarea:focus {
      outline: 2px solid rgba(201, 169, 110, 0.35);
      border-color: var(--accent);
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 22px;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      transition: background 0.2s ease, transform 0.2s ease;
    }
    .button:hover { background: var(--accent-dark); transform: translateY(-1px); }
    .button--ghost {
      background: transparent;
      color: var(--panel);
      border: 1px solid rgba(253, 252, 250, 0.24);
      min-height: 40px;
      padding: 0 16px;
    }
    .button--ghost:hover { background: rgba(253, 252, 250, 0.08); }
    .button--secondary {
      background: #2a1f16;
    }
    .button--secondary:hover { background: #3d2b1f; }
    .button--danger {
      background: #9d3a25;
    }
    .button--danger:hover { background: #7f2d1b; }
    .button--small {
      min-height: 36px;
      padding: 0 14px;
      font-size: 0.86rem;
    }
    .alert {
      margin-top: 22px;
      border: 1px solid rgba(150, 54, 34, 0.28);
      background: #fff3ee;
      color: #8a321f;
      border-radius: 8px;
      padding: 12px 14px;
      font-weight: 600;
    }
    .success {
      margin-top: 22px;
      border: 1px solid rgba(70, 126, 77, 0.28);
      background: #f0f8ef;
      color: #2f6b38;
      border-radius: 8px;
      padding: 12px 14px;
      font-weight: 600;
    }
    [hidden] { display: none !important; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 28px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #fff;
    }
    .card span {
      display: block;
      color: var(--accent-dark);
      font-weight: 700;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .card strong {
      display: block;
      font-family: var(--font-display);
      font-size: 1.45rem;
      line-height: 1.1;
      margin-bottom: 8px;
    }
    .admin-list {
      display: grid;
      gap: 10px;
      margin-top: 24px;
      padding: 0;
      list-style: none;
    }
    .admin-list li {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0;
      border-top: 1px solid var(--line);
      color: var(--muted);
    }
    .admin-list b { color: var(--ink); }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 24px;
    }
    .media-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 24px;
    }
    .media-tab {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--ink);
      cursor: pointer;
      min-height: 40px;
      padding: 0 16px;
      font: inherit;
      font-weight: 700;
    }
    .media-tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .media-layout {
      display: grid;
      grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
      gap: 22px;
      align-items: start;
      margin-top: 24px;
    }
    .media-form {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #fff;
    }
    .media-status {
      min-height: 24px;
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 700;
    }
    .media-targets {
      display: grid;
      gap: 18px;
    }
    .media-target {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }
    .media-target__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    .media-target__head h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 1.5rem;
    }
    .media-target__head span {
      display: block;
      color: var(--muted);
      font-size: 0.82rem;
      margin-top: 3px;
    }
    .media-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 14px;
      padding: 16px;
    }
    .media-image {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #f8f5ef;
    }
    .media-image img,
    .preview-box img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      background: #ede5d9;
    }
    .media-image__body {
      display: grid;
      gap: 8px;
      padding: 10px;
    }
    .media-image__meta {
      color: var(--muted);
      font-size: 0.78rem;
      overflow-wrap: anywhere;
    }
    .media-image__actions {
      display: grid;
      gap: 8px;
    }
    .replace-form {
      display: grid;
      gap: 8px;
      margin: 0;
    }
    .empty-state {
      padding: 18px;
      color: var(--muted);
    }
      .site-content-layout,
      .category-layout,
      .product-layout,
      .blog-layout {
      display: grid;
      grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
      gap: 22px;
      align-items: start;
      margin-top: 24px;
    }
    .site-content-panel,
    .site-content-list,
    .category-panel,
    .category-list,
    .product-panel,
    .product-list,
    .blog-panel,
    .blog-list {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 18px;
    }
    .site-content-panel h2,
    .site-content-list h2,
    .category-panel h2,
    .category-list h2,
    .product-panel h2,
    .product-list h2,
    .blog-panel h2,
    .blog-list h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 1.55rem;
      line-height: 1.1;
    }
    .site-content-panel form,
    .category-panel form,
    .product-panel form,
    .blog-panel form { margin-top: 18px; }
    .site-content-row,
    .category-row,
    .product-row,
    .blog-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 14px;
      padding: 16px 0;
      border-top: 1px solid var(--line);
    }
    .site-content-row:first-child,
    .category-row:first-child,
    .product-row:first-child,
    .blog-row:first-child { border-top: 0; }
    .site-content-thumb,
    .category-thumb,
    .product-thumb,
    .blog-thumb {
      width: 92px;
      aspect-ratio: 1;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8f5ef;
      object-fit: cover;
    }
    .site-content-thumb--empty,
    .category-thumb--empty,
    .product-thumb--empty,
    .blog-thumb--empty {
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 0.78rem;
      text-align: center;
      padding: 8px;
    }
    .site-content-main,
    .category-main,
    .product-main,
    .blog-main {
      min-width: 0;
      display: grid;
      gap: 8px;
    }
    .site-content-titleline,
    .category-titleline,
    .product-titleline,
    .blog-titleline {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .site-content-titleline strong,
    .category-titleline strong,
    .product-titleline strong,
    .blog-titleline strong {
      font-family: var(--font-display);
      font-size: 1.35rem;
      line-height: 1.1;
    }
    .site-content-meta,
    .category-meta,
    .product-meta,
    .blog-meta {
      color: var(--muted);
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge {
      border-radius: 999px;
      background: #efe7d9;
      color: var(--ink);
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 10px;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .badge--ok {
      background: #e6f3e3;
      color: #2f6b38;
    }
    .badge--muted {
      background: #eee8df;
      color: var(--muted);
    }
    .badge--archived {
      background: #f6ded6;
      color: #8a321f;
    }
    .site-content-actions,
    .category-actions,
    .product-actions,
    .blog-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .check-label {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 47px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 14px;
      background: #fff;
    }
    .check-label input {
      width: auto;
      margin: 0;
    }
    .preview-box {
      display: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }
    .preview-box.visible { display: block; }
    .photo-list {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }
    .photo-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fdfcfa;
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 10px;
      padding: 10px;
    }
    .photo-row img,
    .photo-row__empty {
      width: 72px;
      aspect-ratio: 1;
      border-radius: 6px;
      border: 1px solid var(--line);
      object-fit: cover;
      background: #f8f5ef;
    }
    .photo-row__empty {
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 0.74rem;
      text-align: center;
    }
    .photo-row__fields {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .photo-row__buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .category-checks {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      max-height: 180px;
      overflow: auto;
      background: #fff;
    }
    @media (max-width: 760px) {
      .masthead { align-items: flex-start; flex-direction: column; padding: 20px; }
      .content { padding: 24px 20px; }
      .grid { grid-template-columns: 1fr; }
      .admin-list li { display: block; }
      .media-layout { grid-template-columns: 1fr; }
      .media-target__head { align-items: flex-start; flex-direction: column; }
      .site-content-layout,
      .category-layout,
      .product-layout,
      .blog-layout { grid-template-columns: 1fr; }
      .site-content-row,
      .category-row,
      .product-row,
      .blog-row,
      .photo-row { grid-template-columns: 1fr; }
      .site-content-thumb,
      .category-thumb,
      .product-thumb,
      .blog-thumb { width: 100%; max-width: 180px; }
      .photo-row img,
      .photo-row__empty { width: 100%; max-width: 180px; }
      .form-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="panel">
      ${content}
    </section>
  </main>
</body>
</html>`;
}

function loginPage({ error = '', next = '/admin' } = {}) {
  const configError = isAuthConfigured()
    ? ''
    : '<div class="alert">Google přihlášení není nastavené. Přidejte GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_EMAIL a SESSION_SECRET.</div>';
  const errorHtml = error ? `<div class="alert">${escapeHtml(error)}</div>` : '';
  const googleHref = `/admin/auth/google?next=${encodeURIComponent(next)}`;
  return adminLayout('Admin login', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Administrace webu</span>
        </div>
      </div>
      <a class="button button--ghost" href="/">Zpět na web</a>
    </div>
    <div class="content">
      <h1>Přihlášení</h1>
      <p>Přístup je povolen jen přes schválený Google účet.</p>
      ${configError}
      ${errorHtml}
      <div class="actions">
        <a class="button" href="${escapeHtml(googleHref)}">Přihlásit přes Google</a>
      </div>
    </div>
  `);
}

function dashboardPage(session) {
  return adminLayout('Admin dashboard', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <form method="post" action="/admin/logout" style="margin:0;">
        <button class="button button--ghost" type="submit">Odhlásit</button>
      </form>
    </div>
    <div class="content">
      <h1>Admin dashboard</h1>
      <p>Chráněná oblast je připravená pro správu obsahu a další editorské nástroje.</p>
      <div class="grid">
        <div class="card">
          <span>Režim účtů</span>
          <strong>Jeden Google účet</strong>
          <p>Přístup má jen adresa nastavená v GOOGLE_ALLOWED_EMAIL.</p>
        </div>
        <div class="card">
          <span>Zabezpečení</span>
          <strong>Session cookie</strong>
          <p>Přihlášení používá podepsanou HTTP-only cookie platnou 12 hodin.</p>
        </div>
        <div class="card">
          <span>Web</span>
          <strong>Veřejná část</strong>
          <p>Hlavní stránka zůstává dostupná bez přihlášení.</p>
        </div>
      </div>
      <ul class="admin-list">
        <li><b>Veřejný web</b><a href="/">Otevřít hlavní stránku</a></li>
        <li><b>Fotky</b><a href="/admin/media">Nahrát, nahradit nebo smazat obrázky</a></li>
        <li><b>Texty webu</b><a href="/admin/site-content">Upravit texty, fotky a galerie webu</a></li>
        <li><b>Kategorie výrobků</b><a href="/admin/product-categories">Spravovat kategorie, pořadí a viditelnost</a></li>
        <li><b>Výrobky</b><a href="/admin/products">Spravovat výrobky, fotky, kategorie a publikaci</a></li>
        <li><b>Kategorie blogu</b><a href="/admin/blog-categories">Spravovat témata blogu, pořadí a viditelnost</a></li>
        <li><b>Články blogu</b><a href="/admin/blog-posts">Spravovat články, fotky, kategorie a publikaci</a></li>
        <li><b>Konfigurace přístupu</b><span>GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_EMAIL</span></li>
        <li><b>Úložiště</b><span>${isSupabaseConfigured() ? 'Supabase Storage a tabulka media' : 'Lokální soubory v /uploads a metadata v .data/media-db.json'}</span></li>
      </ul>
    </div>
  `);
}

function mediaAdminPage(session) {
  return adminLayout('Správa fotek', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Správa fotek</h1>
      <p>${isSupabaseConfigured() ? 'Nahrané obrázky se ukládají do Supabase Storage a jejich metadata do tabulky media.' : 'Nahrané obrázky se ukládají do lokálního úložiště a jejich URL do databáze médií.'}</p>

      <div class="media-tabs" role="tablist" aria-label="Typy obrázků">
        <button class="media-tab active" type="button" data-tab="site_sections">Sekce webu</button>
        <button class="media-tab" type="button" data-tab="products">Výrobky</button>
        <button class="media-tab" type="button" data-tab="blog_posts">Blog</button>
      </div>

      <div class="media-layout" id="media-app">
        <form class="media-form" id="upload-form" enctype="multipart/form-data">
          <label>
            Typ
            <select name="targetType" id="target-type">
              <option value="site_sections">Sekce webu</option>
              <option value="products">Výrobky</option>
              <option value="blog_posts">Blog</option>
            </select>
          </label>
          <label>
            Položka
            <select name="targetKey" id="target-key"></select>
          </label>
          <label>
            Nová položka
            <input name="targetLabel" id="target-label" placeholder="Název výrobku nebo článku">
          </label>
          <label>
            Fotka
            <input type="file" name="image" id="image-input" accept="image/jpeg,image/png,image/webp,image/gif" required>
          </label>
          <div class="preview-box" id="upload-preview"></div>
          <label>
            Alt text
            <input name="alt" placeholder="Popis obrázku pro přístupnost">
          </label>
          <label>
            Popisek
            <textarea name="caption" placeholder="Volitelný popisek"></textarea>
          </label>
          <input type="hidden" name="replaceMediaId" id="replace-media-id">
          <button class="button" type="submit">Nahrát fotku</button>
          <div class="media-status" id="media-status" role="status"></div>
        </form>

        <div class="media-targets" id="media-targets">
          <div class="empty-state">Načítám fotky...</div>
        </div>
      </div>
    </div>

    <script>
    (function() {
      var state = null;
      var activeType = 'site_sections';
      var labels = {
        site_sections: 'Sekce webu',
        products: 'Výrobky',
        blog_posts: 'Blog'
      };
      var uploadForm = document.getElementById('upload-form');
      var targetType = document.getElementById('target-type');
      var targetKey = document.getElementById('target-key');
      var targetLabel = document.getElementById('target-label');
      var status = document.getElementById('media-status');
      var targetsRoot = document.getElementById('media-targets');
      var imageInput = document.getElementById('image-input');
      var preview = document.getElementById('upload-preview');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function setStatus(message) {
        status.textContent = message || '';
      }

      function getTargets(type) {
        if (!state || !state.targets || !state.targets[type]) return {};
        return state.targets[type];
      }

      function sortedTargetEntries(type) {
        return Object.keys(getTargets(type)).sort(function(a, b) {
          return String(getTargets(type)[a].label || a).localeCompare(String(getTargets(type)[b].label || b), 'cs');
        }).map(function(key) {
          return [key, getTargets(type)[key]];
        });
      }

      function syncTargetSelect() {
        var entries = sortedTargetEntries(targetType.value);
        var html = targetType.value === 'site_sections' ? '' : '<option value="">Vytvořit novou položku</option>';
        entries.forEach(function(entry) {
          html += '<option value="' + escapeHtml(entry[0]) + '">' + escapeHtml(entry[1].label || entry[0]) + '</option>';
        });
        targetKey.innerHTML = html;
        targetLabel.placeholder = targetType.value === 'blog_posts' ? 'Název článku' : 'Název výrobku nebo sekce';
      }

      function renderTabs() {
        document.querySelectorAll('.media-tab').forEach(function(tab) {
          tab.classList.toggle('active', tab.dataset.tab === activeType);
        });
        targetType.value = activeType;
        syncTargetSelect();
      }

      function renderTargets() {
        var entries = sortedTargetEntries(activeType);
        renderTabs();
        if (!entries.length) {
          targetsRoot.innerHTML = '<div class="empty-state">Zatím tu nejsou žádné položky pro ' + escapeHtml(labels[activeType]) + '.</div>';
          return;
        }

        targetsRoot.innerHTML = entries.map(function(entry) {
          var key = entry[0];
          var target = entry[1];
          var images = Array.isArray(target.images) ? target.images : [];
          var imagesHtml = images.length ? images.map(function(image) {
            return '<article class="media-image">' +
              '<img src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.alt || target.label || key) + '">' +
              '<div class="media-image__body">' +
                '<strong>' + (image.is_featured ? 'Hlavní fotka' : 'Fotka') + '</strong>' +
                '<div class="media-image__meta">' + escapeHtml(image.alt || image.caption || image.url) + '</div>' +
                '<form class="replace-form" data-replace-form>' +
                  '<input type="hidden" name="targetType" value="' + escapeHtml(activeType) + '">' +
                  '<input type="hidden" name="targetKey" value="' + escapeHtml(key) + '">' +
                  '<input type="hidden" name="targetLabel" value="' + escapeHtml(target.label || key) + '">' +
                  '<input type="hidden" name="replaceMediaId" value="' + escapeHtml(image.media_id) + '">' +
                  '<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required>' +
                  '<input name="alt" value="' + escapeHtml(image.alt || '') + '" placeholder="Alt text">' +
                  '<button class="button button--secondary button--small" type="submit">Nahradit</button>' +
                '</form>' +
                '<button class="button button--danger button--small" type="button" data-delete="' + escapeHtml(image.media_id) + '" data-target-type="' + escapeHtml(activeType) + '" data-target-key="' + escapeHtml(key) + '">Smazat</button>' +
              '</div>' +
            '</article>';
          }).join('') : '<div class="empty-state">Bez fotek.</div>';

          return '<section class="media-target">' +
            '<div class="media-target__head">' +
              '<div><h2>' + escapeHtml(target.label || key) + '</h2><span>' + escapeHtml(key) + ' · ' + images.length + ' fotek</span></div>' +
              '<button class="button button--small" type="button" data-add-to="' + escapeHtml(key) + '" data-label="' + escapeHtml(target.label || key) + '">Přidat sem</button>' +
            '</div>' +
            '<div class="media-grid">' + imagesHtml + '</div>' +
          '</section>';
        }).join('');
      }

      async function loadMedia() {
        var response = await fetch('/admin/api/media', { headers: { Accept: 'application/json' } });
        state = await response.json();
        if (!response.ok) throw new Error(state.error || 'Fotky se nepodařilo načíst.');
        renderTargets();
      }

      async function upload(form) {
        setStatus('Ukládám...');
        var response = await fetch('/admin/api/media/upload', {
          method: 'POST',
          body: new FormData(form)
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nahrání se nepodařilo.');
        form.reset();
        preview.classList.remove('visible');
        preview.innerHTML = '';
        setStatus('Uloženo.');
        await loadMedia();
      }

      async function deleteImage(targetTypeValue, targetKeyValue, mediaId) {
        setStatus('Mažu...');
        var response = await fetch('/admin/api/media/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ targetType: targetTypeValue, targetKey: targetKeyValue, mediaId: mediaId })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Smazání se nepodařilo.');
        setStatus('Smazáno.');
        await loadMedia();
      }

      uploadForm.addEventListener('submit', function(event) {
        event.preventDefault();
        upload(uploadForm).catch(function(error) { setStatus(error.message); });
      });

      imageInput.addEventListener('change', function() {
        var file = imageInput.files && imageInput.files[0];
        if (!file) {
          preview.classList.remove('visible');
          preview.innerHTML = '';
          return;
        }
        var url = URL.createObjectURL(file);
        preview.innerHTML = '<img src="' + escapeHtml(url) + '" alt="">';
        preview.classList.add('visible');
      });

      targetType.addEventListener('change', function() {
        activeType = targetType.value;
        renderTargets();
      });

      document.querySelectorAll('.media-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          activeType = tab.dataset.tab;
          renderTargets();
        });
      });

      targetsRoot.addEventListener('click', function(event) {
        var addButton = event.target.closest('[data-add-to]');
        if (addButton) {
          targetType.value = activeType;
          syncTargetSelect();
          targetKey.value = addButton.dataset.addTo;
          targetLabel.value = addButton.dataset.label || '';
          imageInput.focus();
          return;
        }

        var deleteButton = event.target.closest('[data-delete]');
        if (deleteButton) {
          deleteImage(deleteButton.dataset.targetType, deleteButton.dataset.targetKey, deleteButton.dataset.delete)
            .catch(function(error) { setStatus(error.message); });
        }
      });

      targetsRoot.addEventListener('submit', function(event) {
        var form = event.target.closest('[data-replace-form]');
        if (!form) return;
        event.preventDefault();
        upload(form).catch(function(error) { setStatus(error.message); });
      });

      loadMedia().catch(function(error) {
        targetsRoot.innerHTML = '<div class="alert">' + escapeHtml(error.message) + '</div>';
      });
    })();
    </script>
  `);
}

function siteContentAdminPage(session) {
  return adminLayout('Texty a fotky webu', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <a class="button button--ghost" href="/admin/media">Fotky</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Texty a fotky webu</h1>
      <p>Editor obecných sekcí webu ukládá obsah do tabulky site_content.</p>
      <div id="site-content-message" hidden></div>

      <div class="site-content-layout" id="site-content-app">
        <section class="site-content-panel">
          <h2 id="site-content-form-title">Nový obsah</h2>
          <form id="site-content-form">
            <input type="hidden" id="site-content-id">
            <label>
              Rychlá šablona
              <select id="site-content-preset">
                <option value="">Vybrat šablonu...</option>
                <option value="hero">Homepage hero</option>
                <option value="hero_image">Homepage hero obrázek</option>
                <option value="about">O nás</option>
                <option value="craft">Řemeslo / filozofie</option>
                <option value="contact">Kontakt</option>
                <option value="gallery">Galerie</option>
                <option value="products_intro">Úvod výrobků</option>
                <option value="blog_intro">Úvod blogu</option>
              </select>
            </label>
            <div class="form-row">
              <label>
                Jazyk
                <input id="site-content-locale" value="cs" required pattern="[a-z]{2}(-[a-z]{2})?">
              </label>
              <label>
                Sekce
                <select id="site-content-section">
                  <option value="homepage">Homepage</option>
                  <option value="about">O nás</option>
                  <option value="craft">Řemeslo</option>
                  <option value="contact">Kontakt</option>
                  <option value="gallery">Galerie</option>
                  <option value="products">Výrobky</option>
                  <option value="blog">Blog</option>
                  <option value="global">Globální</option>
                </select>
              </label>
            </div>
            <label>
              Popisek pro klienta
              <input id="site-content-label" required autocomplete="off">
            </label>
            <label>
              Klíč obsahu
              <input id="site-content-key" required autocomplete="off" pattern="[a-z0-9][a-z0-9_.-]*" placeholder="homepage.hero.title">
            </label>
            <div class="form-row">
              <label>
                Typ obsahu
                <select id="site-content-type">
                  <option value="text">Text</option>
                  <option value="rich_text">Delší text / HTML</option>
                  <option value="image">Obrázek</option>
                  <option value="gallery">Galerie</option>
                  <option value="link">Odkaz</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <label>
                Stav
                <select id="site-content-status">
                  <option value="draft">Koncept</option>
                  <option value="published">Publikováno</option>
                  <option value="archived">Archiv</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <label>
                Pořadí
                <input id="site-content-sort-order" type="number" step="1" value="0">
              </label>
              <label>
                Datum publikace
                <input id="site-content-published-at" type="datetime-local">
              </label>
            </div>

            <div data-value-panel="text">
              <label>
                Text
                <textarea id="site-content-text" rows="5"></textarea>
              </label>
            </div>

            <div data-value-panel="rich_text" hidden>
              <label>
                Delší text / HTML
                <textarea id="site-content-rich-text" rows="7"></textarea>
              </label>
            </div>

            <div data-value-panel="image" hidden>
              <label>
                Obrázek URL
                <input id="site-content-image-url" placeholder="/uploads/site_sections/fotka.jpg">
              </label>
              <div class="form-row">
                <label>
                  Alt text
                  <input id="site-content-image-alt">
                </label>
                <label>
                  Media ID
                  <input id="site-content-image-media-id">
                </label>
              </div>
              <label>
                Popisek
                <input id="site-content-image-caption">
              </label>
              <label>
                Nahrát obrázek
                <input id="site-content-image-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
              </label>
              <button class="button button--secondary button--small" id="site-content-image-upload-button" type="button">Nahrát do obsahu</button>
            </div>

            <div data-value-panel="gallery" hidden>
              <label>
                Přidat fotku URL
                <input id="site-content-gallery-url" placeholder="/uploads/site_sections/fotka.jpg">
              </label>
              <div class="form-row">
                <label>
                  Alt text
                  <input id="site-content-gallery-alt">
                </label>
                <label>
                  Media ID
                  <input id="site-content-gallery-media-id">
                </label>
              </div>
              <button class="button button--secondary button--small" id="site-content-gallery-add" type="button">Přidat URL fotku</button>
              <label>
                Nahrát fotku do galerie
                <input id="site-content-gallery-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
              </label>
              <button class="button button--secondary button--small" id="site-content-gallery-upload-button" type="button">Nahrát a přidat</button>
              <div class="photo-list" id="site-content-gallery-photos"></div>
            </div>

            <div data-value-panel="link" hidden>
              <label>
                Text odkazu
                <input id="site-content-link-label">
              </label>
              <label>
                URL odkazu
                <input id="site-content-link-url" placeholder="/kontakt nebo https://...">
              </label>
            </div>

            <div data-value-panel="json" hidden>
              <label>
                JSON hodnota
                <textarea id="site-content-json" rows="7" spellcheck="false">{}</textarea>
              </label>
            </div>

            <div class="actions">
              <button class="button" type="submit">Uložit</button>
              <button class="button button--secondary" id="site-content-reset" type="button">Nový</button>
            </div>
          </form>
        </section>

        <section class="site-content-list">
          <div class="toolbar" style="margin-top:0;">
            <h2>Obsah webu</h2>
            <button class="button button--secondary button--small" id="site-content-reload" type="button">Obnovit</button>
          </div>
          <div id="site-content-root" class="empty-state">Načítám obsah...</div>
        </section>
      </div>
    </div>

    <script>
    (function() {
      var items = [];
      var galleryImages = [];
      var editedId = '';
      var keyTouched = false;
      var presets = {
        hero: { section: 'homepage', key: 'homepage.hero', label: 'Homepage hero text', type: 'rich_text', sort: 10, text: 'Hlavní nadpis a úvodní text homepage.' },
        hero_image: { section: 'homepage', key: 'homepage.hero.image', label: 'Homepage hero obrázek', type: 'image', sort: 11 },
        about: { section: 'about', key: 'about.text', label: 'O nás text', type: 'rich_text', sort: 20, text: 'Text o značce a autorovi.' },
        craft: { section: 'craft', key: 'craft.philosophy', label: 'Řemeslo a filozofie', type: 'rich_text', sort: 30, text: 'Text o práci se dřevem a hodnotách.' },
        contact: { section: 'contact', key: 'contact.text', label: 'Kontakt text', type: 'rich_text', sort: 40, text: 'Text v kontaktní sekci.' },
        gallery: { section: 'gallery', key: 'gallery.images', label: 'Galerie obrázků', type: 'gallery', sort: 50 },
        products_intro: { section: 'products', key: 'products.intro', label: 'Úvod k výrobkům', type: 'rich_text', sort: 60, text: 'Krátký text nad výpisem výrobků.' },
        blog_intro: { section: 'blog', key: 'blog.intro', label: 'Úvod blogu', type: 'rich_text', sort: 70, text: 'Krátký text nad blogem.' }
      };

      var form = document.getElementById('site-content-form');
      var formTitle = document.getElementById('site-content-form-title');
      var message = document.getElementById('site-content-message');
      var root = document.getElementById('site-content-root');
      var idInput = document.getElementById('site-content-id');
      var presetInput = document.getElementById('site-content-preset');
      var localeInput = document.getElementById('site-content-locale');
      var sectionInput = document.getElementById('site-content-section');
      var labelInput = document.getElementById('site-content-label');
      var keyInput = document.getElementById('site-content-key');
      var typeInput = document.getElementById('site-content-type');
      var statusInput = document.getElementById('site-content-status');
      var sortOrderInput = document.getElementById('site-content-sort-order');
      var publishedAtInput = document.getElementById('site-content-published-at');
      var textInput = document.getElementById('site-content-text');
      var richTextInput = document.getElementById('site-content-rich-text');
      var imageUrlInput = document.getElementById('site-content-image-url');
      var imageAltInput = document.getElementById('site-content-image-alt');
      var imageMediaIdInput = document.getElementById('site-content-image-media-id');
      var imageCaptionInput = document.getElementById('site-content-image-caption');
      var imageUploadInput = document.getElementById('site-content-image-upload');
      var galleryUrlInput = document.getElementById('site-content-gallery-url');
      var galleryAltInput = document.getElementById('site-content-gallery-alt');
      var galleryMediaIdInput = document.getElementById('site-content-gallery-media-id');
      var galleryUploadInput = document.getElementById('site-content-gallery-upload');
      var galleryRoot = document.getElementById('site-content-gallery-photos');
      var linkLabelInput = document.getElementById('site-content-link-label');
      var linkUrlInput = document.getElementById('site-content-link-url');
      var jsonInput = document.getElementById('site-content-json');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function keyify(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\\.+|\\.+$/g, '');
      }

      function setMessage(text, type) {
        message.hidden = !text;
        message.className = type === 'success' ? 'success' : 'alert';
        message.textContent = text || '';
      }

      function formatDateForInput(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }

      function normalizePhotoOrder() {
        galleryImages = galleryImages.map(function(photo, index) {
          return Object.assign({}, photo, {
            sort_order: index,
            is_featured: index === 0
          });
        });
      }

      function renderGallery() {
        normalizePhotoOrder();
        if (!galleryImages.length) {
          galleryRoot.innerHTML = '<div class="empty-state">Galerie je prázdná.</div>';
          return;
        }
        galleryRoot.innerHTML = galleryImages.map(function(photo, index) {
          var thumb = photo.url
            ? '<img src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.alt || '') + '">'
            : '<div class="photo-row__empty">Bez náhledu</div>';
          return '<article class="photo-row" data-index="' + index + '">' +
            thumb +
            '<div class="photo-row__fields">' +
              '<input data-photo-field="url" value="' + escapeHtml(photo.url || '') + '" placeholder="URL">' +
              '<input data-photo-field="alt" value="' + escapeHtml(photo.alt || '') + '" placeholder="Alt text">' +
              '<input data-photo-field="caption" value="' + escapeHtml(photo.caption || '') + '" placeholder="Popisek">' +
              '<input data-photo-field="media_id" value="' + escapeHtml(photo.media_id || '') + '" placeholder="Media ID">' +
              '<div class="photo-row__buttons">' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="up">Nahoru</button>' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="down">Dolů</button>' +
                '<button class="button button--danger button--small" type="button" data-photo-action="remove">Odebrat</button>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      function showValuePanel() {
        var type = typeInput.value;
        Array.prototype.slice.call(document.querySelectorAll('[data-value-panel]')).forEach(function(panel) {
          panel.hidden = panel.getAttribute('data-value-panel') !== type;
        });
        renderGallery();
      }

      function valueForItem(item) {
        return item && item.value && typeof item.value === 'object' ? item.value : {};
      }

      function currentValue() {
        if (typeInput.value === 'text') return { text: textInput.value.trim() };
        if (typeInput.value === 'rich_text') return { html: richTextInput.value.trim() };
        if (typeInput.value === 'image') {
          return {
            url: imageUrlInput.value.trim(),
            alt: imageAltInput.value.trim(),
            caption: imageCaptionInput.value.trim(),
            media_id: imageMediaIdInput.value.trim()
          };
        }
        if (typeInput.value === 'gallery') return { images: galleryImages };
        if (typeInput.value === 'link') {
          return {
            label: linkLabelInput.value.trim(),
            url: linkUrlInput.value.trim()
          };
        }
        try {
          return JSON.parse(jsonInput.value || '{}');
        } catch (error) {
          throw new Error('JSON hodnota není platná.');
        }
      }

      function currentPayload() {
        return {
          locale: localeInput.value.trim() || 'cs',
          section: sectionInput.value.trim(),
          label: labelInput.value.trim(),
          content_key: keyInput.value.trim().toLowerCase(),
          content_type: typeInput.value,
          value: currentValue(),
          status: statusInput.value,
          sort_order: sortOrderInput.value,
          published_at: publishedAtInput.value
        };
      }

      function resetForm() {
        editedId = '';
        keyTouched = false;
        galleryImages = [];
        formTitle.textContent = 'Nový obsah';
        idInput.value = '';
        form.reset();
        localeInput.value = 'cs';
        sectionInput.value = 'homepage';
        typeInput.value = 'text';
        statusInput.value = 'draft';
        sortOrderInput.value = '0';
        jsonInput.value = '{}';
        showValuePanel();
        labelInput.focus();
      }

      function fillValueInputs(item) {
        var value = valueForItem(item);
        textInput.value = item.content_type === 'text' ? (value.text || '') : '';
        richTextInput.value = item.content_type === 'rich_text' ? (value.html || value.text || '') : '';
        imageUrlInput.value = item.content_type === 'image' ? (value.url || '') : '';
        imageAltInput.value = item.content_type === 'image' ? (value.alt || '') : '';
        imageMediaIdInput.value = item.content_type === 'image' ? (value.media_id || '') : '';
        imageCaptionInput.value = item.content_type === 'image' ? (value.caption || '') : '';
        galleryImages = item.content_type === 'gallery' && Array.isArray(value.images)
          ? value.images.map(function(photo) { return Object.assign({}, photo); })
          : [];
        linkLabelInput.value = item.content_type === 'link' ? (value.label || '') : '';
        linkUrlInput.value = item.content_type === 'link' ? (value.url || '') : '';
        jsonInput.value = item.content_type === 'json' ? JSON.stringify(value, null, 2) : '{}';
      }

      function editItem(item) {
        editedId = item.id;
        keyTouched = true;
        formTitle.textContent = 'Upravit obsah';
        idInput.value = item.id;
        localeInput.value = item.locale || 'cs';
        sectionInput.value = item.section || 'homepage';
        labelInput.value = item.label || '';
        keyInput.value = item.content_key || '';
        typeInput.value = item.content_type || 'text';
        statusInput.value = item.status || 'draft';
        sortOrderInput.value = item.sort_order || 0;
        publishedAtInput.value = formatDateForInput(item.published_at);
        fillValueInputs(item);
        showValuePanel();
        labelInput.focus();
      }

      function statusBadges(item) {
        var badges = [];
        if (item.status === 'archived') {
          badges.push('<span class="badge badge--archived">Archiv</span>');
        } else if (item.status === 'published') {
          badges.push('<span class="badge badge--ok">Publikováno</span>');
        } else {
          badges.push('<span class="badge badge--muted">Koncept</span>');
        }
        badges.push('<span class="badge">' + escapeHtml(item.content_type || 'text') + '</span>');
        badges.push('<span class="badge">Pořadí ' + escapeHtml(item.sort_order || 0) + '</span>');
        return '<div class="badges">' + badges.join('') + '</div>';
      }

      function itemSummary(item) {
        var value = valueForItem(item);
        if (item.content_type === 'text') return value.text || '';
        if (item.content_type === 'rich_text') return value.html || value.text || '';
        if (item.content_type === 'image') return value.caption || value.alt || value.url || '';
        if (item.content_type === 'gallery') return Array.isArray(value.images) ? value.images.length + ' fotek' : 'Galerie';
        if (item.content_type === 'link') return [value.label, value.url].filter(Boolean).join(' - ');
        return JSON.stringify(value);
      }

      function itemThumb(item) {
        var value = valueForItem(item);
        var url = '';
        var alt = item.label || '';
        if (item.content_type === 'image') {
          url = value.url || '';
          alt = value.alt || alt;
        } else if (item.content_type === 'gallery' && Array.isArray(value.images) && value.images[0]) {
          url = value.images[0].url || '';
          alt = value.images[0].alt || alt;
        }
        return url
          ? '<img class="site-content-thumb" src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '">'
          : '<div class="site-content-thumb site-content-thumb--empty">Bez náhledu</div>';
      }

      function renderItems() {
        if (!items.length) {
          root.className = 'empty-state';
          root.innerHTML = 'Zatím tu není žádný editovatelný obsah.';
          return;
        }
        root.className = '';
        root.innerHTML = items.map(function(item) {
          var archived = item.status === 'archived';
          var actionHtml = archived
            ? '<button class="button button--secondary button--small" type="button" data-action="restore" data-id="' + escapeHtml(item.id) + '">Obnovit</button>'
            : '<button class="button button--secondary button--small" type="button" data-action="toggle-published" data-id="' + escapeHtml(item.id) + '">' + (item.status === 'published' ? 'Stáhnout' : 'Publikovat') + '</button>' +
              '<button class="button button--danger button--small" type="button" data-action="archive" data-id="' + escapeHtml(item.id) + '">Archivovat</button>';
          return '<article class="site-content-row">' +
            itemThumb(item) +
            '<div class="site-content-main">' +
              '<div class="site-content-titleline"><strong>' + escapeHtml(item.label) + '</strong>' + statusBadges(item) + '</div>' +
              '<div class="site-content-meta">' + escapeHtml(item.locale || 'cs') + ' / ' + escapeHtml(item.section) + ' / ' + escapeHtml(item.content_key) + '</div>' +
              (itemSummary(item) ? '<p>' + escapeHtml(itemSummary(item)).slice(0, 180) + '</p>' : '') +
              '<div class="site-content-actions">' +
                '<button class="button button--small" type="button" data-action="edit" data-id="' + escapeHtml(item.id) + '">Upravit</button>' +
                actionHtml +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      async function requestJson(url, options) {
        var response = await fetch(url, Object.assign({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařil.');
        return data;
      }

      async function loadItems() {
        root.className = 'empty-state';
        root.textContent = 'Načítám obsah...';
        var data = await requestJson('/admin/api/site-content');
        items = data.contents || [];
        renderItems();
      }

      async function saveItem(payload, id) {
        var data = await requestJson(id ? '/admin/api/site-content/' + encodeURIComponent(id) : '/admin/api/site-content', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        setMessage('Obsah byl uložen.', 'success');
        await loadItems();
        editItem(data.content);
      }

      async function uploadPhoto(targetMode) {
        var fileInput = targetMode === 'gallery' ? galleryUploadInput : imageUploadInput;
        var file = fileInput.files && fileInput.files[0];
        if (!file) throw new Error('Vyberte fotku k nahrání.');
        var body = new FormData();
        body.append('image', file);
        body.append('targetLabel', labelInput.value.trim() || keyInput.value.trim() || 'Sekce webu');
        body.append('targetKey', keyInput.value.trim() || keyify(labelInput.value) || 'sekce-webu');
        body.append('alt', targetMode === 'gallery' ? galleryAltInput.value.trim() : imageAltInput.value.trim());
        var response = await fetch('/admin/api/site-content/photo-upload', {
          method: 'POST',
          body: body,
          headers: { Accept: 'application/json' }
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nahrání se nepodařilo.');
        fileInput.value = '';
        return data.photo;
      }

      function payloadFromItem(item, overrides) {
        return Object.assign({
          locale: item.locale || 'cs',
          section: item.section || 'homepage',
          label: item.label || '',
          content_key: item.content_key || '',
          content_type: item.content_type || 'text',
          value: valueForItem(item),
          status: item.status || 'draft',
          sort_order: item.sort_order || 0,
          published_at: item.published_at || ''
        }, overrides || {});
      }

      presetInput.addEventListener('change', function() {
        var preset = presets[presetInput.value];
        if (!preset) return;
        sectionInput.value = preset.section;
        labelInput.value = preset.label;
        keyInput.value = preset.key;
        typeInput.value = preset.type;
        sortOrderInput.value = preset.sort;
        if (preset.type === 'rich_text') richTextInput.value = preset.text || '';
        if (preset.type === 'text') textInput.value = preset.text || '';
        keyTouched = true;
        showValuePanel();
      });

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        setMessage('', 'success');
        try {
          saveItem(currentPayload(), editedId).catch(function(error) {
            setMessage(error.message, 'error');
          });
        } catch (error) {
          setMessage(error.message, 'error');
        }
      });

      labelInput.addEventListener('input', function() {
        if (!keyTouched) keyInput.value = keyify(sectionInput.value + '.' + labelInput.value);
      });

      keyInput.addEventListener('input', function() {
        keyTouched = true;
        keyInput.value = keyify(keyInput.value);
      });

      typeInput.addEventListener('change', showValuePanel);

      document.getElementById('site-content-reset').addEventListener('click', function() {
        setMessage('', 'success');
        resetForm();
      });

      document.getElementById('site-content-reload').addEventListener('click', function() {
        loadItems().catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      document.getElementById('site-content-image-upload-button').addEventListener('click', function() {
        setMessage('Nahrávám obrázek...', 'success');
        uploadPhoto('image').then(function(photo) {
          imageUrlInput.value = photo.url || '';
          imageAltInput.value = photo.alt || imageAltInput.value;
          imageCaptionInput.value = photo.caption || imageCaptionInput.value;
          imageMediaIdInput.value = photo.media_id || '';
          setMessage('Obrázek byl nahrán. Nezapomeňte obsah uložit.', 'success');
        }).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      document.getElementById('site-content-gallery-add').addEventListener('click', function() {
        var url = galleryUrlInput.value.trim();
        var mediaId = galleryMediaIdInput.value.trim();
        if (!url && !mediaId) {
          setMessage('Zadejte URL fotky nebo Media ID.', 'error');
          return;
        }
        galleryImages.push({
          media_id: mediaId,
          url: url,
          alt: galleryAltInput.value.trim(),
          caption: '',
          sort_order: galleryImages.length,
          is_featured: galleryImages.length === 0
        });
        galleryUrlInput.value = '';
        galleryAltInput.value = '';
        galleryMediaIdInput.value = '';
        renderGallery();
      });

      document.getElementById('site-content-gallery-upload-button').addEventListener('click', function() {
        setMessage('Nahrávám fotku...', 'success');
        uploadPhoto('gallery').then(function(photo) {
          galleryImages.push(photo);
          renderGallery();
          setMessage('Fotka byla přidána. Nezapomeňte obsah uložit.', 'success');
        }).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      galleryRoot.addEventListener('input', function(event) {
        var field = event.target.getAttribute('data-photo-field');
        if (!field) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !galleryImages[index]) return;
        galleryImages[index][field] = event.target.value;
      });

      galleryRoot.addEventListener('click', function(event) {
        var action = event.target.getAttribute('data-photo-action');
        if (!action) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !galleryImages[index]) return;
        if (action === 'remove') {
          galleryImages.splice(index, 1);
        } else if (action === 'up' && index > 0) {
          var up = galleryImages[index - 1];
          galleryImages[index - 1] = galleryImages[index];
          galleryImages[index] = up;
        } else if (action === 'down' && index < galleryImages.length - 1) {
          var down = galleryImages[index + 1];
          galleryImages[index + 1] = galleryImages[index];
          galleryImages[index] = down;
        }
        renderGallery();
      });

      root.addEventListener('click', function(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var id = button.dataset.id;
        var item = items.find(function(entry) { return entry.id === id; });
        if (!item && button.dataset.action !== 'restore') return;
        if (button.dataset.action === 'edit') {
          editItem(item);
        } else if (button.dataset.action === 'toggle-published') {
          saveItem(payloadFromItem(item, {
            status: item.status === 'published' ? 'draft' : 'published',
            published_at: item.status === 'published' ? '' : item.published_at
          }), id).catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'archive') {
          if (!window.confirm('Archivovat tento obsah? Zůstane v databázi, ale nebude veřejně dostupný.')) return;
          requestJson('/admin/api/site-content/' + encodeURIComponent(id) + '/archive', { method: 'POST', body: '{}' })
            .then(function() {
              setMessage('Obsah byl archivován.', 'success');
              if (editedId === id) resetForm();
              return loadItems();
            })
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'restore') {
          requestJson('/admin/api/site-content/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' })
            .then(function() {
              setMessage('Obsah byl obnoven jako koncept.', 'success');
              return loadItems();
            })
            .catch(function(error) { setMessage(error.message, 'error'); });
        }
      });

      resetForm();
      loadItems().catch(function(error) {
        setMessage(error.message, 'error');
        root.className = 'empty-state';
        root.textContent = 'Obsah se nepodařilo načíst.';
      });
    })();
    </script>
  `);
}

function productCategoriesAdminPage(session) {
  return adminLayout('Kategorie výrobků', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <a class="button button--ghost" href="/admin/media">Fotky</a>
        <a class="button button--ghost" href="/admin/products">Výrobky</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Kategorie výrobků</h1>
      <p>Správa skupin výrobků pro pozdější filtrování a přiřazení produktů.</p>
      <div id="category-message" hidden></div>

      <div class="category-layout" id="category-app">
        <section class="category-panel">
          <h2 id="category-form-title">Nová kategorie</h2>
          <form id="category-form">
            <input type="hidden" id="category-id">
            <label>
              Název
              <input id="category-title" name="title" required autocomplete="off">
            </label>
            <label>
              Slug
              <input id="category-slug" name="slug" required autocomplete="off" pattern="[a-z0-9][a-z0-9-]*">
            </label>
            <label>
              Popis
              <textarea id="category-description" name="description"></textarea>
            </label>
            <div class="form-row">
              <label>
                Pořadí
                <input id="category-sort-order" name="sort_order" type="number" step="1" value="0">
              </label>
              <label>
                Viditelnost
                <span class="check-label">
                  <input id="category-visible" name="is_visible" type="checkbox" checked>
                  Zobrazit
                </span>
              </label>
            </div>
            <label>
              Obrázek URL
              <input id="category-image-url" name="image_url" placeholder="/uploads/products/kategorie.jpg">
            </label>
            <div class="form-row">
              <label>
                Alt text
                <input id="category-image-alt" name="image_alt">
              </label>
              <label>
                Media ID
                <input id="category-image-media-id" name="image_media_id">
              </label>
            </div>
            <div class="actions">
              <button class="button" type="submit">Uložit</button>
              <button class="button button--secondary" id="category-reset" type="button">Nová</button>
            </div>
          </form>
        </section>

        <section class="category-list">
          <div class="toolbar" style="margin-top:0;">
            <h2>Seznam kategorií</h2>
            <button class="button button--secondary button--small" id="category-reload" type="button">Obnovit</button>
          </div>
          <div id="categories-root" class="empty-state">Načítám kategorie...</div>
        </section>
      </div>
    </div>

    <script>
    (function() {
      var categories = [];
      var editedId = '';
      var slugTouched = false;
      var form = document.getElementById('category-form');
      var formTitle = document.getElementById('category-form-title');
      var message = document.getElementById('category-message');
      var root = document.getElementById('categories-root');
      var idInput = document.getElementById('category-id');
      var titleInput = document.getElementById('category-title');
      var slugInput = document.getElementById('category-slug');
      var descriptionInput = document.getElementById('category-description');
      var sortOrderInput = document.getElementById('category-sort-order');
      var visibleInput = document.getElementById('category-visible');
      var imageUrlInput = document.getElementById('category-image-url');
      var imageAltInput = document.getElementById('category-image-alt');
      var imageMediaIdInput = document.getElementById('category-image-media-id');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function slugify(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function setMessage(text, type) {
        message.hidden = !text;
        message.className = type === 'success' ? 'success' : 'alert';
        message.textContent = text || '';
      }

      function imageFromCategory(category) {
        return category && category.image && typeof category.image === 'object' ? category.image : {};
      }

      function payloadFromCategory(category, overrides) {
        var image = imageFromCategory(category);
        return Object.assign({
          title: category.title || '',
          slug: category.slug || '',
          description: category.description || '',
          sort_order: category.sort_order || 0,
          is_visible: category.is_visible === true,
          image_url: image.url || '',
          image_alt: image.alt || '',
          image_media_id: image.media_id || ''
        }, overrides || {});
      }

      function currentPayload() {
        return {
          title: titleInput.value.trim(),
          slug: slugInput.value.trim().toLowerCase(),
          description: descriptionInput.value.trim(),
          sort_order: sortOrderInput.value,
          is_visible: visibleInput.checked,
          image_url: imageUrlInput.value.trim(),
          image_alt: imageAltInput.value.trim(),
          image_media_id: imageMediaIdInput.value.trim()
        };
      }

      function resetForm() {
        editedId = '';
        slugTouched = false;
        formTitle.textContent = 'Nová kategorie';
        idInput.value = '';
        form.reset();
        sortOrderInput.value = '0';
        visibleInput.checked = true;
        titleInput.focus();
      }

      function editCategory(category) {
        var image = imageFromCategory(category);
        editedId = category.id;
        slugTouched = true;
        formTitle.textContent = 'Upravit kategorii';
        idInput.value = category.id;
        titleInput.value = category.title || '';
        slugInput.value = category.slug || '';
        descriptionInput.value = category.description || '';
        sortOrderInput.value = category.sort_order || 0;
        visibleInput.checked = category.is_visible === true;
        imageUrlInput.value = image.url || '';
        imageAltInput.value = image.alt || '';
        imageMediaIdInput.value = image.media_id || '';
        titleInput.focus();
      }

      function statusBadges(category) {
        var badges = [];
        if (category.archived_at) {
          badges.push('<span class="badge badge--archived">Archiv</span>');
        } else if (category.is_visible) {
          badges.push('<span class="badge badge--ok">Viditelná</span>');
        } else {
          badges.push('<span class="badge badge--muted">Skrytá</span>');
        }
        badges.push('<span class="badge">Pořadí ' + escapeHtml(category.sort_order || 0) + '</span>');
        return '<div class="badges">' + badges.join('') + '</div>';
      }

      function render() {
        if (!categories.length) {
          root.className = 'empty-state';
          root.innerHTML = 'Zatím tu nejsou žádné kategorie.';
          return;
        }

        root.className = '';
        root.innerHTML = categories.map(function(category) {
          var image = imageFromCategory(category);
          var thumb = image.url
            ? '<img class="category-thumb" src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.alt || category.title) + '">'
            : '<div class="category-thumb category-thumb--empty">Bez obrázku</div>';
          var archived = Boolean(category.archived_at);
          var toggleLabel = category.is_visible ? 'Skrýt' : 'Zobrazit';
          var actionHtml = archived
            ? '<button class="button button--secondary button--small" type="button" data-action="restore" data-id="' + escapeHtml(category.id) + '">Obnovit</button>'
            : '<button class="button button--secondary button--small" type="button" data-action="toggle" data-id="' + escapeHtml(category.id) + '">' + toggleLabel + '</button>' +
              '<button class="button button--danger button--small" type="button" data-action="archive" data-id="' + escapeHtml(category.id) + '">Archivovat</button>';

          return '<article class="category-row">' +
            thumb +
            '<div class="category-main">' +
              '<div class="category-titleline"><strong>' + escapeHtml(category.title) + '</strong>' + statusBadges(category) + '</div>' +
              '<div class="category-meta">/' + escapeHtml(category.slug) + '</div>' +
              (category.description ? '<p>' + escapeHtml(category.description) + '</p>' : '') +
              '<div class="category-actions">' +
                '<button class="button button--small" type="button" data-action="edit" data-id="' + escapeHtml(category.id) + '">Upravit</button>' +
                actionHtml +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      async function requestJson(url, options) {
        var response = await fetch(url, Object.assign({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařil.');
        return data;
      }

      async function loadCategories() {
        root.className = 'empty-state';
        root.textContent = 'Načítám kategorie...';
        var data = await requestJson('/admin/api/product-categories');
        categories = data.categories || [];
        render();
      }

      async function saveCategory(payload, id) {
        var data = await requestJson(id ? '/admin/api/product-categories/' + encodeURIComponent(id) : '/admin/api/product-categories', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        setMessage('Kategorie byla uložena.', 'success');
        await loadCategories();
        editCategory(data.category);
      }

      async function archiveCategory(id) {
        if (!window.confirm('Archivovat tuto kategorii? U produktů zůstane zachovaná, ale nebude veřejně viditelná.')) return;
        await requestJson('/admin/api/product-categories/' + encodeURIComponent(id) + '/archive', { method: 'POST', body: '{}' });
        setMessage('Kategorie byla archivována.', 'success');
        await loadCategories();
        if (editedId === id) resetForm();
      }

      async function restoreCategory(id) {
        await requestJson('/admin/api/product-categories/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' });
        setMessage('Kategorie byla obnovena.', 'success');
        await loadCategories();
      }

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        setMessage('', 'success');
        saveCategory(currentPayload(), editedId).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      titleInput.addEventListener('input', function() {
        if (!slugTouched) slugInput.value = slugify(titleInput.value);
      });

      slugInput.addEventListener('input', function() {
        slugTouched = true;
        slugInput.value = slugify(slugInput.value);
      });

      document.getElementById('category-reset').addEventListener('click', function() {
        setMessage('', 'success');
        resetForm();
      });

      document.getElementById('category-reload').addEventListener('click', function() {
        loadCategories().catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      root.addEventListener('click', function(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var id = button.dataset.id;
        var category = categories.find(function(item) { return item.id === id; });
        if (!category && button.dataset.action !== 'restore') return;

        if (button.dataset.action === 'edit') {
          editCategory(category);
        } else if (button.dataset.action === 'toggle') {
          saveCategory(payloadFromCategory(category, { is_visible: !category.is_visible }), id)
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'archive') {
          archiveCategory(id).catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'restore') {
          restoreCategory(id).catch(function(error) { setMessage(error.message, 'error'); });
        }
      });

      loadCategories().catch(function(error) {
        setMessage(error.message, 'error');
        root.className = 'empty-state';
        root.textContent = 'Kategorie se nepodařilo načíst.';
      });
    })();
    </script>
  `);
}

function blogCategoriesAdminPage(session) {
  return adminLayout('Kategorie blogu', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <a class="button button--ghost" href="/admin/media">Fotky</a>
        <a class="button button--ghost" href="/admin/product-categories">Kategorie výrobků</a>
        <a class="button button--ghost" href="/admin/products">Výrobky</a>
        <a class="button button--ghost" href="/admin/blog-posts">Články</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Kategorie blogu</h1>
      <p>Správa témat blogu pro pozdější filtrování a přiřazení článků.</p>
      <div id="category-message" hidden></div>

      <div class="category-layout" id="category-app">
        <section class="category-panel">
          <h2 id="category-form-title">Nová kategorie</h2>
          <form id="category-form">
            <input type="hidden" id="category-id">
            <label>
              Název
              <input id="category-title" name="title" required autocomplete="off">
            </label>
            <label>
              Slug
              <input id="category-slug" name="slug" required autocomplete="off" pattern="[a-z0-9][a-z0-9-]*">
            </label>
            <label>
              Popis
              <textarea id="category-description" name="description"></textarea>
            </label>
            <div class="form-row">
              <label>
                Pořadí
                <input id="category-sort-order" name="sort_order" type="number" step="1" value="0">
              </label>
              <label>
                Viditelnost
                <span class="check-label">
                  <input id="category-visible" name="is_visible" type="checkbox" checked>
                  Zobrazit
                </span>
              </label>
            </div>
            <label>
              Obrázek URL
              <input id="category-image-url" name="image_url" placeholder="/uploads/blog/kategorie.jpg">
            </label>
            <div class="form-row">
              <label>
                Alt text
                <input id="category-image-alt" name="image_alt">
              </label>
              <label>
                Media ID
                <input id="category-image-media-id" name="image_media_id">
              </label>
            </div>
            <div class="actions">
              <button class="button" type="submit">Uložit</button>
              <button class="button button--secondary" id="category-reset" type="button">Nová</button>
            </div>
          </form>
        </section>

        <section class="category-list">
          <div class="toolbar" style="margin-top:0;">
            <h2>Seznam kategorií</h2>
            <button class="button button--secondary button--small" id="category-reload" type="button">Obnovit</button>
          </div>
          <div id="categories-root" class="empty-state">Načítám kategorie...</div>
        </section>
      </div>
    </div>

    <script>
    (function() {
      var categories = [];
      var editedId = '';
      var slugTouched = false;
      var form = document.getElementById('category-form');
      var formTitle = document.getElementById('category-form-title');
      var message = document.getElementById('category-message');
      var root = document.getElementById('categories-root');
      var idInput = document.getElementById('category-id');
      var titleInput = document.getElementById('category-title');
      var slugInput = document.getElementById('category-slug');
      var descriptionInput = document.getElementById('category-description');
      var sortOrderInput = document.getElementById('category-sort-order');
      var visibleInput = document.getElementById('category-visible');
      var imageUrlInput = document.getElementById('category-image-url');
      var imageAltInput = document.getElementById('category-image-alt');
      var imageMediaIdInput = document.getElementById('category-image-media-id');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function slugify(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function setMessage(text, type) {
        message.hidden = !text;
        message.className = type === 'success' ? 'success' : 'alert';
        message.textContent = text || '';
      }

      function imageFromCategory(category) {
        return category && category.image && typeof category.image === 'object' ? category.image : {};
      }

      function payloadFromCategory(category, overrides) {
        var image = imageFromCategory(category);
        return Object.assign({
          title: category.title || '',
          slug: category.slug || '',
          description: category.description || '',
          sort_order: category.sort_order || 0,
          is_visible: category.is_visible === true,
          image_url: image.url || '',
          image_alt: image.alt || '',
          image_media_id: image.media_id || ''
        }, overrides || {});
      }

      function currentPayload() {
        return {
          title: titleInput.value.trim(),
          slug: slugInput.value.trim().toLowerCase(),
          description: descriptionInput.value.trim(),
          sort_order: sortOrderInput.value,
          is_visible: visibleInput.checked,
          image_url: imageUrlInput.value.trim(),
          image_alt: imageAltInput.value.trim(),
          image_media_id: imageMediaIdInput.value.trim()
        };
      }

      function resetForm() {
        editedId = '';
        slugTouched = false;
        formTitle.textContent = 'Nová kategorie';
        idInput.value = '';
        form.reset();
        sortOrderInput.value = '0';
        visibleInput.checked = true;
        titleInput.focus();
      }

      function editCategory(category) {
        var image = imageFromCategory(category);
        editedId = category.id;
        slugTouched = true;
        formTitle.textContent = 'Upravit kategorii';
        idInput.value = category.id;
        titleInput.value = category.title || '';
        slugInput.value = category.slug || '';
        descriptionInput.value = category.description || '';
        sortOrderInput.value = category.sort_order || 0;
        visibleInput.checked = category.is_visible === true;
        imageUrlInput.value = image.url || '';
        imageAltInput.value = image.alt || '';
        imageMediaIdInput.value = image.media_id || '';
        titleInput.focus();
      }

      function statusBadges(category) {
        var badges = [];
        if (category.archived_at) {
          badges.push('<span class="badge badge--archived">Archiv</span>');
        } else if (category.is_visible) {
          badges.push('<span class="badge badge--ok">Viditelná</span>');
        } else {
          badges.push('<span class="badge badge--muted">Skrytá</span>');
        }
        badges.push('<span class="badge">Pořadí ' + escapeHtml(category.sort_order || 0) + '</span>');
        return '<div class="badges">' + badges.join('') + '</div>';
      }

      function render() {
        if (!categories.length) {
          root.className = 'empty-state';
          root.innerHTML = 'Zatím tu nejsou žádné kategorie blogu.';
          return;
        }

        root.className = '';
        root.innerHTML = categories.map(function(category) {
          var image = imageFromCategory(category);
          var thumb = image.url
            ? '<img class="category-thumb" src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.alt || category.title) + '">'
            : '<div class="category-thumb category-thumb--empty">Bez obrázku</div>';
          var archived = Boolean(category.archived_at);
          var toggleLabel = category.is_visible ? 'Skrýt' : 'Zobrazit';
          var actionHtml = archived
            ? '<button class="button button--secondary button--small" type="button" data-action="restore" data-id="' + escapeHtml(category.id) + '">Obnovit</button>'
            : '<button class="button button--secondary button--small" type="button" data-action="toggle" data-id="' + escapeHtml(category.id) + '">' + toggleLabel + '</button>' +
              '<button class="button button--danger button--small" type="button" data-action="archive" data-id="' + escapeHtml(category.id) + '">Archivovat</button>';

          return '<article class="category-row">' +
            thumb +
            '<div class="category-main">' +
              '<div class="category-titleline"><strong>' + escapeHtml(category.title) + '</strong>' + statusBadges(category) + '</div>' +
              '<div class="category-meta">/' + escapeHtml(category.slug) + '</div>' +
              (category.description ? '<p>' + escapeHtml(category.description) + '</p>' : '') +
              '<div class="category-actions">' +
                '<button class="button button--small" type="button" data-action="edit" data-id="' + escapeHtml(category.id) + '">Upravit</button>' +
                actionHtml +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      async function requestJson(url, options) {
        var response = await fetch(url, Object.assign({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařil.');
        return data;
      }

      async function loadCategories() {
        root.className = 'empty-state';
        root.textContent = 'Načítám kategorie...';
        var data = await requestJson('/admin/api/blog-categories');
        categories = data.categories || [];
        render();
      }

      async function saveCategory(payload, id) {
        var data = await requestJson(id ? '/admin/api/blog-categories/' + encodeURIComponent(id) : '/admin/api/blog-categories', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        setMessage('Kategorie blogu byla uložena.', 'success');
        await loadCategories();
        editCategory(data.category);
      }

      async function archiveCategory(id) {
        if (!window.confirm('Archivovat tuto kategorii blogu? U článků zůstane zachovaná, ale nebude veřejně viditelná.')) return;
        await requestJson('/admin/api/blog-categories/' + encodeURIComponent(id) + '/archive', { method: 'POST', body: '{}' });
        setMessage('Kategorie blogu byla archivována.', 'success');
        await loadCategories();
        if (editedId === id) resetForm();
      }

      async function restoreCategory(id) {
        await requestJson('/admin/api/blog-categories/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' });
        setMessage('Kategorie blogu byla obnovena.', 'success');
        await loadCategories();
      }

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        setMessage('', 'success');
        saveCategory(currentPayload(), editedId).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      titleInput.addEventListener('input', function() {
        if (!slugTouched) slugInput.value = slugify(titleInput.value);
      });

      slugInput.addEventListener('input', function() {
        slugTouched = true;
        slugInput.value = slugify(slugInput.value);
      });

      document.getElementById('category-reset').addEventListener('click', function() {
        setMessage('', 'success');
        resetForm();
      });

      document.getElementById('category-reload').addEventListener('click', function() {
        loadCategories().catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      root.addEventListener('click', function(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var id = button.dataset.id;
        var category = categories.find(function(item) { return item.id === id; });
        if (!category && button.dataset.action !== 'restore') return;

        if (button.dataset.action === 'edit') {
          editCategory(category);
        } else if (button.dataset.action === 'toggle') {
          saveCategory(payloadFromCategory(category, { is_visible: !category.is_visible }), id)
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'archive') {
          archiveCategory(id).catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'restore') {
          restoreCategory(id).catch(function(error) { setMessage(error.message, 'error'); });
        }
      });

      loadCategories().catch(function(error) {
        setMessage(error.message, 'error');
        root.className = 'empty-state';
        root.textContent = 'Kategorie blogu se nepodařilo načíst.';
      });
    })();
    </script>
  `);
}

function productsAdminPage(session) {
  return adminLayout('Výrobky', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <a class="button button--ghost" href="/admin/media">Fotky</a>
        <a class="button button--ghost" href="/admin/product-categories">Kategorie</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Výrobky</h1>
      <p>Správa výrobků, kategorií, fotek, pořadí a publikace pro veřejný web.</p>
      <div id="product-message" hidden></div>

      <div class="product-layout" id="product-app">
        <section class="product-panel">
          <h2 id="product-form-title">Nový výrobek</h2>
          <form id="product-form">
            <input type="hidden" id="product-id">
            <label>
              Název
              <input id="product-title" name="title" required autocomplete="off">
            </label>
            <label>
              Slug
              <input id="product-slug" name="slug" required autocomplete="off" pattern="[a-z0-9][a-z0-9-]*">
            </label>
            <label>
              Krátký popis
              <textarea id="product-short-description" name="short_description"></textarea>
            </label>
            <label>
              Celý popis
              <textarea id="product-description" name="description"></textarea>
            </label>
            <div class="form-row">
              <label>
                Pořadí
                <input id="product-sort-order" name="sort_order" type="number" step="1" value="0">
              </label>
              <label>
                Datum publikace
                <input id="product-published-at" name="published_at" type="datetime-local">
              </label>
            </div>
            <div class="form-row">
              <label>
                Viditelnost
                <span class="check-label">
                  <input id="product-visible" name="is_visible" type="checkbox" checked>
                  Zobrazit
                </span>
              </label>
              <label>
                Publikace
                <span class="check-label">
                  <input id="product-published" name="is_published" type="checkbox">
                  Publikovat
                </span>
              </label>
            </div>
            <label>
              Kategorie
              <div class="category-checks" id="product-category-checks">
                <span class="product-meta">Načítám kategorie...</span>
              </div>
            </label>

            <label>
              Přidat fotku URL
              <input id="product-photo-url" placeholder="/uploads/products/fotka.jpg">
            </label>
            <div class="form-row">
              <label>
                Alt text
                <input id="product-photo-alt" placeholder="Popis fotky">
              </label>
              <label>
                Media ID
                <input id="product-photo-media-id" placeholder="Volitelné">
              </label>
            </div>
            <button class="button button--secondary button--small" id="product-add-photo" type="button">Přidat URL fotku</button>

            <label>
              Nahrát fotku
              <input id="product-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
            </label>
            <button class="button button--secondary button--small" id="product-upload-button" type="button">Nahrát a přidat</button>

            <div class="photo-list" id="product-photos"></div>

            <div class="actions">
              <button class="button" type="submit">Uložit</button>
              <button class="button button--secondary" id="product-reset" type="button">Nový</button>
            </div>
          </form>
        </section>

        <section class="product-list">
          <div class="toolbar" style="margin-top:0;">
            <h2>Seznam výrobků</h2>
            <button class="button button--secondary button--small" id="product-reload" type="button">Obnovit</button>
          </div>
          <div id="products-root" class="empty-state">Načítám výrobky...</div>
        </section>
      </div>
    </div>

    <script>
    (function() {
      var products = [];
      var categories = [];
      var photos = [];
      var editedId = '';
      var slugTouched = false;
      var form = document.getElementById('product-form');
      var formTitle = document.getElementById('product-form-title');
      var message = document.getElementById('product-message');
      var root = document.getElementById('products-root');
      var idInput = document.getElementById('product-id');
      var titleInput = document.getElementById('product-title');
      var slugInput = document.getElementById('product-slug');
      var shortDescriptionInput = document.getElementById('product-short-description');
      var descriptionInput = document.getElementById('product-description');
      var sortOrderInput = document.getElementById('product-sort-order');
      var visibleInput = document.getElementById('product-visible');
      var publishedInput = document.getElementById('product-published');
      var publishedAtInput = document.getElementById('product-published-at');
      var categoryChecks = document.getElementById('product-category-checks');
      var photoUrlInput = document.getElementById('product-photo-url');
      var photoAltInput = document.getElementById('product-photo-alt');
      var photoMediaIdInput = document.getElementById('product-photo-media-id');
      var uploadInput = document.getElementById('product-upload');
      var photosRoot = document.getElementById('product-photos');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function slugify(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function setMessage(text, type) {
        message.hidden = !text;
        message.className = type === 'success' ? 'success' : 'alert';
        message.textContent = text || '';
      }

      function firstPhoto(product) {
        var items = Array.isArray(product && product.photos) ? product.photos : [];
        return items.length ? items[0] : null;
      }

      function formatDateForInput(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }

      function selectedCategoryIds() {
        return Array.prototype.slice.call(categoryChecks.querySelectorAll('input[type="checkbox"]:checked'))
          .map(function(input) { return input.value; });
      }

      function currentPayload() {
        return {
          title: titleInput.value.trim(),
          slug: slugInput.value.trim().toLowerCase(),
          short_description: shortDescriptionInput.value.trim(),
          description: descriptionInput.value.trim(),
          photos: photos,
          category_ids: selectedCategoryIds(),
          sort_order: sortOrderInput.value,
          is_visible: visibleInput.checked,
          is_published: publishedInput.checked,
          published_at: publishedAtInput.value
        };
      }

      function resetForm() {
        editedId = '';
        slugTouched = false;
        photos = [];
        formTitle.textContent = 'Nový výrobek';
        idInput.value = '';
        form.reset();
        sortOrderInput.value = '0';
        visibleInput.checked = true;
        publishedInput.checked = false;
        renderCategoryChecks([]);
        renderPhotos();
        titleInput.focus();
      }

      function editProduct(product) {
        editedId = product.id;
        slugTouched = true;
        photos = Array.isArray(product.photos) ? product.photos.map(function(photo) { return Object.assign({}, photo); }) : [];
        formTitle.textContent = 'Upravit výrobek';
        idInput.value = product.id;
        titleInput.value = product.title || '';
        slugInput.value = product.slug || '';
        shortDescriptionInput.value = product.short_description || '';
        descriptionInput.value = product.description || '';
        sortOrderInput.value = product.sort_order || 0;
        visibleInput.checked = product.is_visible === true;
        publishedInput.checked = product.is_published === true;
        publishedAtInput.value = formatDateForInput(product.published_at);
        renderCategoryChecks(product.category_ids || []);
        renderPhotos();
        titleInput.focus();
      }

      function renderCategoryChecks(selectedIds) {
        if (!categories.length) {
          categoryChecks.innerHTML = '<span class="product-meta">Nejdřív vytvořte kategorii výrobků.</span>';
          return;
        }
        categoryChecks.innerHTML = categories.map(function(category) {
          var checked = selectedIds.indexOf(category.id) !== -1 ? ' checked' : '';
          var muted = category.archived_at ? ' (archiv)' : category.is_visible ? '' : ' (skrytá)';
          return '<label class="check-label">' +
            '<input type="checkbox" value="' + escapeHtml(category.id) + '"' + checked + '>' +
            escapeHtml(category.title + muted) +
          '</label>';
        }).join('');
      }

      function normalizePhotoOrder() {
        photos = photos.map(function(photo, index) {
          return Object.assign({}, photo, {
            sort_order: index,
            is_featured: index === 0
          });
        });
      }

      function renderPhotos() {
        normalizePhotoOrder();
        if (!photos.length) {
          photosRoot.innerHTML = '<div class="empty-state">Bez fotek.</div>';
          return;
        }
        photosRoot.innerHTML = photos.map(function(photo, index) {
          var thumb = photo.url
            ? '<img src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.alt || '') + '">'
            : '<div class="photo-row__empty">Bez náhledu</div>';
          return '<article class="photo-row" data-index="' + index + '">' +
            thumb +
            '<div class="photo-row__fields">' +
              '<input data-photo-field="url" value="' + escapeHtml(photo.url || '') + '" placeholder="URL">' +
              '<input data-photo-field="alt" value="' + escapeHtml(photo.alt || '') + '" placeholder="Alt text">' +
              '<input data-photo-field="caption" value="' + escapeHtml(photo.caption || '') + '" placeholder="Popisek">' +
              '<input data-photo-field="media_id" value="' + escapeHtml(photo.media_id || '') + '" placeholder="Media ID">' +
              '<div class="photo-row__buttons">' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="up">Nahoru</button>' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="down">Dolů</button>' +
                '<button class="button button--danger button--small" type="button" data-photo-action="remove">Odebrat</button>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      function statusBadges(product) {
        var badges = [];
        if (product.archived_at) {
          badges.push('<span class="badge badge--archived">Archiv</span>');
        } else {
          badges.push(product.is_visible ? '<span class="badge badge--ok">Viditelný</span>' : '<span class="badge badge--muted">Skrytý</span>');
          badges.push(product.is_published ? '<span class="badge badge--ok">Publikovaný</span>' : '<span class="badge badge--muted">Koncept</span>');
        }
        badges.push('<span class="badge">Pořadí ' + escapeHtml(product.sort_order || 0) + '</span>');
        return '<div class="badges">' + badges.join('') + '</div>';
      }

      function renderProducts() {
        if (!products.length) {
          root.className = 'empty-state';
          root.innerHTML = 'Zatím tu nejsou žádné výrobky.';
          return;
        }

        root.className = '';
        root.innerHTML = products.map(function(product) {
          var photo = firstPhoto(product);
          var thumb = photo && photo.url
            ? '<img class="product-thumb" src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.alt || product.title) + '">'
            : '<div class="product-thumb product-thumb--empty">Bez fotky</div>';
          var archived = Boolean(product.archived_at);
          var categoryText = product.categories && product.categories.length
            ? product.categories.map(function(category) { return category.title; }).join(', ')
            : 'Bez kategorie';
          var actionHtml = archived
            ? '<button class="button button--secondary button--small" type="button" data-action="restore" data-id="' + escapeHtml(product.id) + '">Obnovit</button>'
            : '<button class="button button--secondary button--small" type="button" data-action="toggle-visible" data-id="' + escapeHtml(product.id) + '">' + (product.is_visible ? 'Skrýt' : 'Zobrazit') + '</button>' +
              '<button class="button button--secondary button--small" type="button" data-action="toggle-published" data-id="' + escapeHtml(product.id) + '">' + (product.is_published ? 'Stáhnout' : 'Publikovat') + '</button>' +
              '<button class="button button--danger button--small" type="button" data-action="archive" data-id="' + escapeHtml(product.id) + '">Archivovat</button>';

          return '<article class="product-row">' +
            thumb +
            '<div class="product-main">' +
              '<div class="product-titleline"><strong>' + escapeHtml(product.title) + '</strong>' + statusBadges(product) + '</div>' +
              '<div class="product-meta">/' + escapeHtml(product.slug) + ' · ' + escapeHtml(categoryText) + '</div>' +
              (product.short_description ? '<p>' + escapeHtml(product.short_description) + '</p>' : '') +
              '<div class="product-actions">' +
                '<button class="button button--small" type="button" data-action="edit" data-id="' + escapeHtml(product.id) + '">Upravit</button>' +
                actionHtml +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      async function requestJson(url, options) {
        var response = await fetch(url, Object.assign({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařil.');
        return data;
      }

      async function loadData() {
        root.className = 'empty-state';
        root.textContent = 'Načítám výrobky...';
        var data = await requestJson('/admin/api/products');
        products = data.products || [];
        categories = data.categories || [];
        renderCategoryChecks(selectedCategoryIds());
        renderProducts();
      }

      async function saveProduct(payload, id) {
        var data = await requestJson(id ? '/admin/api/products/' + encodeURIComponent(id) : '/admin/api/products', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        setMessage('Výrobek byl uložen.', 'success');
        await loadData();
        editProduct(data.product);
      }

      async function archiveProduct(id) {
        if (!window.confirm('Archivovat tento výrobek? Zůstane v databázi, ale nebude veřejně viditelný.')) return;
        await requestJson('/admin/api/products/' + encodeURIComponent(id) + '/archive', { method: 'POST', body: '{}' });
        setMessage('Výrobek byl archivován.', 'success');
        await loadData();
        if (editedId === id) resetForm();
      }

      async function restoreProduct(id) {
        await requestJson('/admin/api/products/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' });
        setMessage('Výrobek byl obnoven.', 'success');
        await loadData();
      }

      async function uploadPhoto() {
        var file = uploadInput.files && uploadInput.files[0];
        if (!file) throw new Error('Vyberte fotku k nahrání.');
        var body = new FormData();
        body.append('image', file);
        body.append('targetLabel', titleInput.value.trim() || slugInput.value.trim() || 'Výrobek');
        body.append('targetKey', slugInput.value.trim() || slugify(titleInput.value) || 'vyrobek');
        body.append('alt', photoAltInput.value.trim() || titleInput.value.trim());
        var response = await fetch('/admin/api/products/photo-upload', {
          method: 'POST',
          body: body,
          headers: { Accept: 'application/json' }
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nahrání se nepodařilo.');
        photos.push(data.photo);
        uploadInput.value = '';
        renderPhotos();
      }

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        setMessage('', 'success');
        saveProduct(currentPayload(), editedId).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      titleInput.addEventListener('input', function() {
        if (!slugTouched) slugInput.value = slugify(titleInput.value);
      });

      slugInput.addEventListener('input', function() {
        slugTouched = true;
        slugInput.value = slugify(slugInput.value);
      });

      document.getElementById('product-reset').addEventListener('click', function() {
        setMessage('', 'success');
        resetForm();
      });

      document.getElementById('product-reload').addEventListener('click', function() {
        loadData().catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      document.getElementById('product-add-photo').addEventListener('click', function() {
        var url = photoUrlInput.value.trim();
        var mediaId = photoMediaIdInput.value.trim();
        if (!url && !mediaId) {
          setMessage('Zadejte URL fotky nebo Media ID.', 'error');
          return;
        }
        photos.push({
          media_id: mediaId,
          url: url,
          alt: photoAltInput.value.trim(),
          caption: '',
          sort_order: photos.length,
          is_featured: photos.length === 0
        });
        photoUrlInput.value = '';
        photoAltInput.value = '';
        photoMediaIdInput.value = '';
        renderPhotos();
      });

      document.getElementById('product-upload-button').addEventListener('click', function() {
        setMessage('Nahrávám fotku...', 'success');
        uploadPhoto().then(function() {
          setMessage('Fotka byla přidána. Nezapomeňte výrobek uložit.', 'success');
        }).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      photosRoot.addEventListener('input', function(event) {
        var field = event.target.getAttribute('data-photo-field');
        if (!field) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !photos[index]) return;
        photos[index][field] = event.target.value;
      });

      photosRoot.addEventListener('click', function(event) {
        var action = event.target.getAttribute('data-photo-action');
        if (!action) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !photos[index]) return;
        if (action === 'remove') {
          photos.splice(index, 1);
        } else if (action === 'up' && index > 0) {
          var up = photos[index - 1];
          photos[index - 1] = photos[index];
          photos[index] = up;
        } else if (action === 'down' && index < photos.length - 1) {
          var down = photos[index + 1];
          photos[index + 1] = photos[index];
          photos[index] = down;
        }
        renderPhotos();
      });

      root.addEventListener('click', function(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var id = button.dataset.id;
        var product = products.find(function(item) { return item.id === id; });
        if (!product && button.dataset.action !== 'restore') return;

        if (button.dataset.action === 'edit') {
          editProduct(product);
        } else if (button.dataset.action === 'toggle-visible') {
          saveProduct(Object.assign({}, product, { category_ids: product.category_ids || [], is_visible: !product.is_visible }), id)
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'toggle-published') {
          saveProduct(Object.assign({}, product, { category_ids: product.category_ids || [], is_published: !product.is_published, published_at: product.is_published ? null : product.published_at }), id)
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'archive') {
          archiveProduct(id).catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'restore') {
          restoreProduct(id).catch(function(error) { setMessage(error.message, 'error'); });
        }
      });

      loadData().catch(function(error) {
        setMessage(error.message, 'error');
        root.className = 'empty-state';
        root.textContent = 'Výrobky se nepodařilo načíst.';
      });
    })();
    </script>
  `);
}

function blogPostsAdminPage(session) {
  return adminLayout('Články blogu', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Přihlášen: ${escapeHtml(session.email)}</span>
        </div>
      </div>
      <div class="actions" style="margin:0;">
        <a class="button button--ghost" href="/admin">Dashboard</a>
        <a class="button button--ghost" href="/admin/media">Fotky</a>
        <a class="button button--ghost" href="/admin/blog-categories">Kategorie</a>
        <form method="post" action="/admin/logout" style="margin:0;">
          <button class="button button--ghost" type="submit">Odhlásit</button>
        </form>
      </div>
    </div>
    <div class="content">
      <h1>Články blogu</h1>
      <p>Správa článků, autorů, fotek, kategorií, pořadí a publikace pro blog.</p>
      <div id="blog-message" hidden></div>

      <div class="blog-layout" id="blog-app">
        <section class="blog-panel">
          <h2 id="blog-form-title">Nový článek</h2>
          <form id="blog-form">
            <input type="hidden" id="blog-id">
            <label>
              Název
              <input id="blog-title" name="title" required autocomplete="off">
            </label>
            <label>
              Slug
              <input id="blog-slug" name="slug" required autocomplete="off" pattern="[a-z0-9][a-z0-9-]*">
            </label>
            <label>
              Úvodní perex
              <textarea id="blog-excerpt" name="excerpt"></textarea>
            </label>
            <label>
              Obsah článku
              <textarea id="blog-main-content" name="main_content" style="min-height:180px;"></textarea>
            </label>
            <div class="form-row">
              <label>
                Autor
                <input id="blog-author-name" name="author_name" autocomplete="off">
              </label>
              <label>
                Formát obsahu
                <select id="blog-content-format" name="content_format">
                  <option value="html">HTML</option>
                  <option value="markdown">Markdown</option>
                  <option value="portable_text">Portable text</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <label>
                Pořadí
                <input id="blog-sort-order" name="sort_order" type="number" step="1" value="0">
              </label>
              <label>
                Datum publikace
                <input id="blog-published-at" name="published_at" type="datetime-local">
              </label>
            </div>
            <label>
              Stav
              <select id="blog-status" name="status">
                <option value="draft">Koncept</option>
                <option value="published">Publikovaný</option>
                <option value="archived">Archiv</option>
              </select>
            </label>
            <label>
              Kategorie
              <div class="category-checks" id="blog-category-checks">
                <span class="blog-meta">Načítám kategorie...</span>
              </div>
            </label>

            <label>
              Přidat fotku URL
              <input id="blog-photo-url" placeholder="/uploads/blog/fotka.jpg">
            </label>
            <div class="form-row">
              <label>
                Alt text
                <input id="blog-photo-alt" placeholder="Popis fotky">
              </label>
              <label>
                Media ID
                <input id="blog-photo-media-id" placeholder="Volitelné">
              </label>
            </div>
            <button class="button button--secondary button--small" id="blog-add-photo" type="button">Přidat URL fotku</button>

            <label>
              Nahrát fotku
              <input id="blog-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
            </label>
            <button class="button button--secondary button--small" id="blog-upload-button" type="button">Nahrát a přidat</button>

            <div class="photo-list" id="blog-photos"></div>

            <div class="actions">
              <button class="button" type="submit">Uložit</button>
              <button class="button button--secondary" id="blog-reset" type="button">Nový</button>
            </div>
          </form>
        </section>

        <section class="blog-list">
          <div class="toolbar" style="margin-top:0;">
            <h2>Seznam článků</h2>
            <button class="button button--secondary button--small" id="blog-reload" type="button">Obnovit</button>
          </div>
          <div id="blog-posts-root" class="empty-state">Načítám články...</div>
        </section>
      </div>
    </div>

    <script>
    (function() {
      var posts = [];
      var categories = [];
      var photos = [];
      var editedId = '';
      var slugTouched = false;
      var form = document.getElementById('blog-form');
      var formTitle = document.getElementById('blog-form-title');
      var message = document.getElementById('blog-message');
      var root = document.getElementById('blog-posts-root');
      var idInput = document.getElementById('blog-id');
      var titleInput = document.getElementById('blog-title');
      var slugInput = document.getElementById('blog-slug');
      var excerptInput = document.getElementById('blog-excerpt');
      var mainContentInput = document.getElementById('blog-main-content');
      var authorNameInput = document.getElementById('blog-author-name');
      var contentFormatInput = document.getElementById('blog-content-format');
      var sortOrderInput = document.getElementById('blog-sort-order');
      var publishedAtInput = document.getElementById('blog-published-at');
      var statusInput = document.getElementById('blog-status');
      var categoryChecks = document.getElementById('blog-category-checks');
      var photoUrlInput = document.getElementById('blog-photo-url');
      var photoAltInput = document.getElementById('blog-photo-alt');
      var photoMediaIdInput = document.getElementById('blog-photo-media-id');
      var uploadInput = document.getElementById('blog-upload');
      var photosRoot = document.getElementById('blog-photos');

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function slugify(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function setMessage(text, type) {
        message.hidden = !text;
        message.className = type === 'success' ? 'success' : 'alert';
        message.textContent = text || '';
      }

      function firstPhoto(post) {
        var items = Array.isArray(post && post.photos) ? post.photos : [];
        return items.length ? items[0] : null;
      }

      function formatDateForInput(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }

      function selectedCategoryIds() {
        return Array.prototype.slice.call(categoryChecks.querySelectorAll('input[type="checkbox"]:checked'))
          .map(function(input) { return input.value; });
      }

      function currentPayload() {
        return {
          title: titleInput.value.trim(),
          slug: slugInput.value.trim().toLowerCase(),
          excerpt: excerptInput.value.trim(),
          main_content: mainContentInput.value.trim(),
          content_format: contentFormatInput.value,
          author_name: authorNameInput.value.trim(),
          photos: photos,
          category_ids: selectedCategoryIds(),
          status: statusInput.value,
          published_at: publishedAtInput.value,
          sort_order: sortOrderInput.value
        };
      }

      function resetForm() {
        editedId = '';
        slugTouched = false;
        photos = [];
        formTitle.textContent = 'Nový článek';
        idInput.value = '';
        form.reset();
        sortOrderInput.value = '0';
        contentFormatInput.value = 'html';
        statusInput.value = 'draft';
        renderCategoryChecks([]);
        renderPhotos();
        titleInput.focus();
      }

      function editPost(post) {
        editedId = post.id;
        slugTouched = true;
        photos = Array.isArray(post.photos) ? post.photos.map(function(photo) { return Object.assign({}, photo); }) : [];
        formTitle.textContent = 'Upravit článek';
        idInput.value = post.id;
        titleInput.value = post.title || '';
        slugInput.value = post.slug || '';
        excerptInput.value = post.excerpt || '';
        mainContentInput.value = post.main_content || '';
        authorNameInput.value = post.author_name || '';
        contentFormatInput.value = post.content_format || 'html';
        sortOrderInput.value = post.sort_order || 0;
        publishedAtInput.value = formatDateForInput(post.published_at);
        statusInput.value = post.status || 'draft';
        renderCategoryChecks(post.category_ids || []);
        renderPhotos();
        titleInput.focus();
      }

      function renderCategoryChecks(selectedIds) {
        if (!categories.length) {
          categoryChecks.innerHTML = '<span class="blog-meta">Nejdřív vytvořte kategorii blogu.</span>';
          return;
        }
        categoryChecks.innerHTML = categories.map(function(category) {
          var checked = selectedIds.indexOf(category.id) !== -1 ? ' checked' : '';
          var muted = category.archived_at ? ' (archiv)' : category.is_visible ? '' : ' (skrytá)';
          return '<label class="check-label">' +
            '<input type="checkbox" value="' + escapeHtml(category.id) + '"' + checked + '>' +
            escapeHtml(category.title + muted) +
          '</label>';
        }).join('');
      }

      function normalizePhotoOrder() {
        photos = photos.map(function(photo, index) {
          return Object.assign({}, photo, {
            sort_order: index,
            is_featured: index === 0
          });
        });
      }

      function renderPhotos() {
        normalizePhotoOrder();
        if (!photos.length) {
          photosRoot.innerHTML = '<div class="empty-state">Bez fotek.</div>';
          return;
        }
        photosRoot.innerHTML = photos.map(function(photo, index) {
          var thumb = photo.url
            ? '<img src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.alt || '') + '">'
            : '<div class="photo-row__empty">Bez náhledu</div>';
          return '<article class="photo-row" data-index="' + index + '">' +
            thumb +
            '<div class="photo-row__fields">' +
              '<input data-photo-field="url" value="' + escapeHtml(photo.url || '') + '" placeholder="URL">' +
              '<input data-photo-field="alt" value="' + escapeHtml(photo.alt || '') + '" placeholder="Alt text">' +
              '<input data-photo-field="caption" value="' + escapeHtml(photo.caption || '') + '" placeholder="Popisek">' +
              '<input data-photo-field="media_id" value="' + escapeHtml(photo.media_id || '') + '" placeholder="Media ID">' +
              '<div class="photo-row__buttons">' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="up">Nahoru</button>' +
                '<button class="button button--secondary button--small" type="button" data-photo-action="down">Dolů</button>' +
                '<button class="button button--danger button--small" type="button" data-photo-action="remove">Odebrat</button>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      function statusBadges(post) {
        var badges = [];
        if (post.status === 'archived') {
          badges.push('<span class="badge badge--archived">Archiv</span>');
        } else if (post.status === 'published') {
          badges.push('<span class="badge badge--ok">Publikovaný</span>');
        } else {
          badges.push('<span class="badge badge--muted">Koncept</span>');
        }
        badges.push('<span class="badge">Pořadí ' + escapeHtml(post.sort_order || 0) + '</span>');
        return '<div class="badges">' + badges.join('') + '</div>';
      }

      function renderPosts() {
        if (!posts.length) {
          root.className = 'empty-state';
          root.innerHTML = 'Zatím tu nejsou žádné články.';
          return;
        }

        root.className = '';
        root.innerHTML = posts.map(function(post) {
          var photo = firstPhoto(post);
          var thumb = photo && photo.url
            ? '<img class="blog-thumb" src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.alt || post.title) + '">'
            : '<div class="blog-thumb blog-thumb--empty">Bez fotky</div>';
          var categoryText = post.categories && post.categories.length
            ? post.categories.map(function(category) { return category.title; }).join(', ')
            : 'Bez kategorie';
          var actionHtml = post.status === 'archived'
            ? '<button class="button button--secondary button--small" type="button" data-action="restore" data-id="' + escapeHtml(post.id) + '">Obnovit</button>'
            : '<button class="button button--secondary button--small" type="button" data-action="toggle-published" data-id="' + escapeHtml(post.id) + '">' + (post.status === 'published' ? 'Stáhnout' : 'Publikovat') + '</button>' +
              '<button class="button button--danger button--small" type="button" data-action="archive" data-id="' + escapeHtml(post.id) + '">Archivovat</button>';

          return '<article class="blog-row">' +
            thumb +
            '<div class="blog-main">' +
              '<div class="blog-titleline"><strong>' + escapeHtml(post.title) + '</strong>' + statusBadges(post) + '</div>' +
              '<div class="blog-meta">/' + escapeHtml(post.slug) + ' · ' + escapeHtml(categoryText) + (post.author_name ? ' · ' + escapeHtml(post.author_name) : '') + '</div>' +
              (post.excerpt ? '<p>' + escapeHtml(post.excerpt) + '</p>' : '') +
              '<div class="blog-actions">' +
                '<button class="button button--small" type="button" data-action="edit" data-id="' + escapeHtml(post.id) + '">Upravit</button>' +
                actionHtml +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('');
      }

      async function requestJson(url, options) {
        var response = await fetch(url, Object.assign({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařil.');
        return data;
      }

      async function loadData() {
        root.className = 'empty-state';
        root.textContent = 'Načítám články...';
        var data = await requestJson('/admin/api/blog-posts');
        posts = data.posts || [];
        categories = data.categories || [];
        renderCategoryChecks(selectedCategoryIds());
        renderPosts();
      }

      async function savePost(payload, id) {
        var data = await requestJson(id ? '/admin/api/blog-posts/' + encodeURIComponent(id) : '/admin/api/blog-posts', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        setMessage('Článek byl uložen.', 'success');
        await loadData();
        editPost(data.post);
      }

      async function archivePost(id) {
        if (!window.confirm('Archivovat tento článek? Zůstane v databázi, ale nebude veřejně viditelný.')) return;
        await requestJson('/admin/api/blog-posts/' + encodeURIComponent(id) + '/archive', { method: 'POST', body: '{}' });
        setMessage('Článek byl archivován.', 'success');
        await loadData();
        if (editedId === id) resetForm();
      }

      async function restorePost(id) {
        await requestJson('/admin/api/blog-posts/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' });
        setMessage('Článek byl obnoven jako koncept.', 'success');
        await loadData();
      }

      async function uploadPhoto() {
        var file = uploadInput.files && uploadInput.files[0];
        if (!file) throw new Error('Vyberte fotku k nahrání.');
        var body = new FormData();
        body.append('image', file);
        body.append('targetLabel', titleInput.value.trim() || slugInput.value.trim() || 'Článek');
        body.append('targetKey', slugInput.value.trim() || slugify(titleInput.value) || 'clanek');
        body.append('alt', photoAltInput.value.trim() || titleInput.value.trim());
        var response = await fetch('/admin/api/blog-posts/photo-upload', {
          method: 'POST',
          body: body,
          headers: { Accept: 'application/json' }
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nahrání se nepodařilo.');
        photos.push(data.photo);
        uploadInput.value = '';
        renderPhotos();
      }

      form.addEventListener('submit', function(event) {
        event.preventDefault();
        setMessage('', 'success');
        savePost(currentPayload(), editedId).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      titleInput.addEventListener('input', function() {
        if (!slugTouched) slugInput.value = slugify(titleInput.value);
      });

      slugInput.addEventListener('input', function() {
        slugTouched = true;
        slugInput.value = slugify(slugInput.value);
      });

      document.getElementById('blog-reset').addEventListener('click', function() {
        setMessage('', 'success');
        resetForm();
      });

      document.getElementById('blog-reload').addEventListener('click', function() {
        loadData().catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      document.getElementById('blog-add-photo').addEventListener('click', function() {
        var url = photoUrlInput.value.trim();
        var mediaId = photoMediaIdInput.value.trim();
        if (!url && !mediaId) {
          setMessage('Zadejte URL fotky nebo Media ID.', 'error');
          return;
        }
        photos.push({
          media_id: mediaId,
          url: url,
          alt: photoAltInput.value.trim(),
          caption: '',
          sort_order: photos.length,
          is_featured: photos.length === 0
        });
        photoUrlInput.value = '';
        photoAltInput.value = '';
        photoMediaIdInput.value = '';
        renderPhotos();
      });

      document.getElementById('blog-upload-button').addEventListener('click', function() {
        setMessage('Nahrávám fotku...', 'success');
        uploadPhoto().then(function() {
          setMessage('Fotka byla přidána. Nezapomeňte článek uložit.', 'success');
        }).catch(function(error) {
          setMessage(error.message, 'error');
        });
      });

      photosRoot.addEventListener('input', function(event) {
        var field = event.target.getAttribute('data-photo-field');
        if (!field) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !photos[index]) return;
        photos[index][field] = event.target.value;
      });

      photosRoot.addEventListener('click', function(event) {
        var action = event.target.getAttribute('data-photo-action');
        if (!action) return;
        var row = event.target.closest('[data-index]');
        var index = Number(row && row.dataset.index);
        if (!Number.isFinite(index) || !photos[index]) return;
        if (action === 'remove') {
          photos.splice(index, 1);
        } else if (action === 'up' && index > 0) {
          var up = photos[index - 1];
          photos[index - 1] = photos[index];
          photos[index] = up;
        } else if (action === 'down' && index < photos.length - 1) {
          var down = photos[index + 1];
          photos[index + 1] = photos[index];
          photos[index] = down;
        }
        renderPhotos();
      });

      root.addEventListener('click', function(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var id = button.dataset.id;
        var post = posts.find(function(item) { return item.id === id; });
        if (!post && button.dataset.action !== 'restore') return;

        if (button.dataset.action === 'edit') {
          editPost(post);
        } else if (button.dataset.action === 'toggle-published') {
          savePost(Object.assign({}, post, { category_ids: post.category_ids || [], status: post.status === 'published' ? 'draft' : 'published', published_at: post.status === 'published' ? null : post.published_at }), id)
            .catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'archive') {
          archivePost(id).catch(function(error) { setMessage(error.message, 'error'); });
        } else if (button.dataset.action === 'restore') {
          restorePost(id).catch(function(error) { setMessage(error.message, 'error'); });
        }
      });

      loadData().catch(function(error) {
        setMessage(error.message, 'error');
        root.className = 'empty-state';
        root.textContent = 'Články se nepodařilo načíst.';
      });
    })();
    </script>
  `);
}

function getSafeAdminNext(next) {
  return next && next.startsWith('/admin') && next !== '/admin/login'
    ? next
    : '/admin';
}

function buildGoogleAuthUrl(req, next) {
  const oauthState = createOauthState(next);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${getBaseUrl(req)}/admin/oauth/google/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', oauthState.state);
  authUrl.searchParams.set('prompt', 'select_account');
  if (GOOGLE_ALLOWED_EMAIL) authUrl.searchParams.set('login_hint', GOOGLE_ALLOWED_EMAIL);

  return { ...oauthState, url: authUrl.toString() };
}

async function requestGoogleToken(req, code) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: `${getBaseUrl(req)}/admin/oauth/google/callback`,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Google token exchange failed');
  }
  return data;
}

async function requestGoogleUser(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Google user lookup failed');
  }
  return data;
}

async function parseJsonBody(req) {
  const body = await getRawBody(req, 1024 * 1024);
  if (!body.length) return {};
  return JSON.parse(body.toString('utf8'));
}

function normalizeSupabaseError(error) {
  if (error && error.code === '23505') return 'Slug už používá jiná položka.';
  if (error && error.message) return error.message;
  return 'Požadavek na Supabase se nepodařil.';
}

async function supabaseRequest(table, { method = 'GET', query = {}, body, prefer = '' } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase není nastavený. Doplňte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.');
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(normalizeSupabaseError(data));
    error.statusCode = response.status;
    error.code = data && data.code;
    error.details = data;
    throw error;
  }

  return data;
}

async function supabaseStorageRequest(pathname, { method = 'GET', headers = {}, body } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase není nastavený. Doplňte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.');
  }

  const response = await fetch(`${SUPABASE_URL}/storage/v1/${pathname}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers
    },
    body
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(normalizeSupabaseError(data));
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function uploadSupabaseStorageObject(bucket, storagePath, file) {
  await supabaseStorageRequest(`object/${encodeURIComponent(bucket)}/${storagePathForPublicUrl(storagePath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.mime_type,
      'Cache-Control': '31536000',
      'x-upsert': 'false'
    },
    body: file.buffer
  });
}

async function deleteSupabaseStorageObject(media) {
  if (!media || !media.bucket || !media.storage_path || media.bucket === 'local' || media.bucket === 'static') return;
  await supabaseStorageRequest(`object/${encodeURIComponent(media.bucket)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefixes: [media.storage_path] })
  });
}

function normalizeOptionalImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return '';
  if (imageUrl.startsWith('/')) return imageUrl;

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (error) {
    throw new Error('URL obrázku musí začínat /, http:// nebo https://.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL obrázku musí začínat /, http:// nebo https://.');
  }
  return imageUrl;
}

function normalizeProductCategoryInput(input) {
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const sortOrderRaw = input.sort_order === undefined ? input.sortOrder : input.sort_order;
  const sortOrder = Number.parseInt(sortOrderRaw === undefined || sortOrderRaw === '' ? '0' : String(sortOrderRaw), 10);
  const isVisible = input.is_visible === true || input.is_visible === 'true' || input.is_visible === 'on';
  const existingImage = input.image && typeof input.image === 'object' ? input.image : {};
  const imageUrl = normalizeOptionalImageUrl(input.image_url || existingImage.url || '');
  const imageAlt = String(input.image_alt || existingImage.alt || '').trim();
  const imageMediaId = String(input.image_media_id || existingImage.media_id || '').trim();

  if (!title) throw new Error('Název kategorie je povinný.');
  if (!slug) throw new Error('Slug je povinný.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Slug může obsahovat jen malá písmena bez diakritiky, čísla a pomlčky.');
  }
  if (!Number.isFinite(sortOrder)) throw new Error('Pořadí musí být číslo.');

  // TODO: Replace this temporary URL/media-id shape with Supabase media-table selection
  // after the local upload flow is converted to Supabase Storage.
  const image = imageUrl || imageAlt || imageMediaId
    ? {
        url: imageUrl,
        alt: imageAlt,
        media_id: imageMediaId,
        source: imageMediaId ? 'media-reference' : 'manual-url'
      }
    : null;

  return {
    title,
    slug,
    description: description || null,
    image,
    sort_order: sortOrder,
    is_visible: isVisible
  };
}

function assertUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) {
    throw new Error('Neplatné ID.');
  }
}

function sortProductCategories(categories) {
  return [...categories].sort((a, b) => {
    const aArchived = a.archived_at ? 1 : 0;
    const bArchived = b.archived_at ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
    return String(a.title || '').localeCompare(String(b.title || ''), 'cs');
  });
}

async function listProductCategories() {
  const rows = await supabaseRequest('product_categories', {
    query: {
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at',
      order: 'sort_order.asc,title.asc'
    }
  });
  return sortProductCategories(Array.isArray(rows) ? rows : []);
}

async function assertProductCategorySlugUnique(slug, excludeId = '') {
  const query = {
    select: 'id',
    slug: `eq.${slug}`,
    limit: '1'
  };
  if (excludeId) query.id = `neq.${excludeId}`;
  const rows = await supabaseRequest('product_categories', { query });
  if (Array.isArray(rows) && rows.length) throw new Error('Slug už používá jiná kategorie.');
}

async function createProductCategory(input) {
  const category = normalizeProductCategoryInput(input);
  await assertProductCategorySlugUnique(category.slug);
  const rows = await supabaseRequest('product_categories', {
    method: 'POST',
    body: category,
    prefer: 'return=representation',
    query: { select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at' }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateProductCategory(id, input) {
  assertUuid(id);
  const category = normalizeProductCategoryInput(input);
  await assertProductCategorySlugUnique(category.slug, id);
  const rows = await supabaseRequest('product_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: category,
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie nebyla nalezena.');
  return rows[0];
}

async function archiveProductCategory(id) {
  assertUuid(id);
  const rows = await supabaseRequest('product_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: {
      is_visible: false,
      archived_at: nowIso()
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie nebyla nalezena.');
  return rows[0];
}

async function restoreProductCategory(id) {
  assertUuid(id);
  const rows = await supabaseRequest('product_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: {
      archived_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie nebyla nalezena.');
  return rows[0];
}

function normalizeBlogCategoryInput(input) {
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const sortOrderRaw = input.sort_order === undefined ? input.sortOrder : input.sort_order;
  const sortOrder = Number.parseInt(sortOrderRaw === undefined || sortOrderRaw === '' ? '0' : String(sortOrderRaw), 10);
  const isVisible = input.is_visible === true || input.is_visible === 'true' || input.is_visible === 'on';
  const existingImage = input.image && typeof input.image === 'object' ? input.image : {};
  const imageUrl = normalizeOptionalImageUrl(input.image_url || existingImage.url || '');
  const imageAlt = String(input.image_alt || existingImage.alt || '').trim();
  const imageMediaId = String(input.image_media_id || existingImage.media_id || '').trim();

  if (!title) throw new Error('Název kategorie je povinný.');
  if (!slug) throw new Error('Slug je povinný.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Slug může obsahovat jen malá písmena bez diakritiky, čísla a pomlčky.');
  }
  if (!Number.isFinite(sortOrder)) throw new Error('Pořadí musí být číslo.');

  // TODO: Replace this temporary URL/media-id shape with Supabase media-table selection
  // after the local upload flow is converted to Supabase Storage.
  const image = imageUrl || imageAlt || imageMediaId
    ? {
        url: imageUrl,
        alt: imageAlt,
        media_id: imageMediaId,
        source: imageMediaId ? 'media-reference' : 'manual-url'
      }
    : null;

  return {
    title,
    slug,
    description: description || null,
    image,
    sort_order: sortOrder,
    is_visible: isVisible
  };
}

function sortBlogCategories(categories) {
  return [...categories].sort((a, b) => {
    const aArchived = a.archived_at ? 1 : 0;
    const bArchived = b.archived_at ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
    return String(a.title || '').localeCompare(String(b.title || ''), 'cs');
  });
}

async function listBlogCategories() {
  const rows = await supabaseRequest('blog_categories', {
    query: {
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at',
      order: 'sort_order.asc,title.asc'
    }
  });
  return sortBlogCategories(Array.isArray(rows) ? rows : []);
}

async function assertBlogCategorySlugUnique(slug, excludeId = '') {
  const query = {
    select: 'id',
    slug: `eq.${slug}`,
    limit: '1'
  };
  if (excludeId) query.id = `neq.${excludeId}`;
  const rows = await supabaseRequest('blog_categories', { query });
  if (Array.isArray(rows) && rows.length) throw new Error('Slug už používá jiná kategorie blogu.');
}

async function createBlogCategory(input) {
  const category = normalizeBlogCategoryInput(input);
  await assertBlogCategorySlugUnique(category.slug);
  const rows = await supabaseRequest('blog_categories', {
    method: 'POST',
    body: category,
    prefer: 'return=representation',
    query: { select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at' }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateBlogCategory(id, input) {
  assertUuid(id);
  const category = normalizeBlogCategoryInput(input);
  await assertBlogCategorySlugUnique(category.slug, id);
  const rows = await supabaseRequest('blog_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: category,
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie blogu nebyla nalezena.');
  return rows[0];
}

async function archiveBlogCategory(id) {
  assertUuid(id);
  const rows = await supabaseRequest('blog_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: {
      is_visible: false,
      archived_at: nowIso()
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie blogu nebyla nalezena.');
  return rows[0];
}

async function restoreBlogCategory(id) {
  assertUuid(id);
  const rows = await supabaseRequest('blog_categories', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,created_at,updated_at'
    },
    body: {
      archived_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kategorie blogu nebyla nalezena.');
  return rows[0];
}

function normalizeProductPhotoInput(input, index) {
  const photo = input && typeof input === 'object' ? input : {};
  const url = normalizeOptionalImageUrl(photo.url || '');
  const mediaId = String(photo.media_id || photo.mediaId || '').trim();
  const alt = String(photo.alt || '').trim();
  const caption = String(photo.caption || '').trim();
  if (!url && !mediaId) return null;

  return {
    media_id: mediaId,
    url,
    alt,
    caption,
    sort_order: index,
    is_featured: index === 0
  };
}

function normalizeProductPhotos(input) {
  const photos = Array.isArray(input) ? input : [];
  return photos
    .map((photo, index) => normalizeProductPhotoInput(photo, index))
    .filter(Boolean)
    .map((photo, index) => ({
      ...photo,
      sort_order: index,
      is_featured: index === 0
    }));
}

function normalizePublishedAt(value, isPublished) {
  if (!isPublished) return null;
  const raw = String(value || '').trim();
  if (!raw) return nowIso();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('Datum publikace není platné.');
  return date.toISOString();
}

function normalizeCategoryIds(input) {
  const ids = Array.isArray(input) ? input : [];
  const uniqueIds = [];
  ids.forEach((id) => {
    const value = String(id || '').trim();
    if (!value || uniqueIds.includes(value)) return;
    assertUuid(value);
    uniqueIds.push(value);
  });
  return uniqueIds;
}

function normalizeProductInput(input) {
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const shortDescription = String(input.short_description || input.shortDescription || '').trim();
  const description = String(input.description || '').trim();
  const sortOrderRaw = input.sort_order === undefined ? input.sortOrder : input.sort_order;
  const sortOrder = Number.parseInt(sortOrderRaw === undefined || sortOrderRaw === '' ? '0' : String(sortOrderRaw), 10);
  const isVisible = input.is_visible === true || input.is_visible === 'true' || input.is_visible === 'on';
  const isPublished = input.is_published === true || input.is_published === 'true' || input.is_published === 'on';

  if (!title) throw new Error('Název výrobku je povinný.');
  if (!slug) throw new Error('Slug je povinný.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Slug může obsahovat jen malá písmena bez diakritiky, čísla a pomlčky.');
  }
  if (!Number.isFinite(sortOrder)) throw new Error('Pořadí musí být číslo.');

  return {
    product: {
      title,
      slug,
      short_description: shortDescription || null,
      description: description || null,
      photos: normalizeProductPhotos(input.photos),
      sort_order: sortOrder,
      is_visible: isVisible,
      is_published: isPublished,
      published_at: normalizePublishedAt(input.published_at || input.publishedAt, isPublished)
    },
    categoryIds: normalizeCategoryIds(input.category_ids || input.categoryIds)
  };
}

function sortProducts(products) {
  return [...products].sort((a, b) => {
    const aArchived = a.archived_at ? 1 : 0;
    const bArchived = b.archived_at ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
    return String(a.title || '').localeCompare(String(b.title || ''), 'cs');
  });
}

function attachProductCategories(products, categories, links) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const linksByProduct = new Map();
  links.forEach((link) => {
    if (!linksByProduct.has(link.product_id)) linksByProduct.set(link.product_id, []);
    linksByProduct.get(link.product_id).push(link);
  });

  return products.map((product) => {
    const productLinks = linksByProduct.get(product.id) || [];
    const productCategories = productLinks
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((link) => categoryMap.get(link.category_id))
      .filter(Boolean);
    return {
      ...product,
      category_ids: productCategories.map((category) => category.id),
      categories: productCategories
    };
  });
}

async function listProducts() {
  const [products, categories, links] = await Promise.all([
    supabaseRequest('products', {
      query: {
        select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,created_at,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('product_categories', {
      query: {
        select: 'id,title,slug,sort_order,is_visible,archived_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('product_category_links', {
      query: {
        select: 'product_id,category_id,sort_order',
        order: 'sort_order.asc'
      }
    })
  ]);
  return {
    products: sortProducts(attachProductCategories(
      Array.isArray(products) ? products : [],
      Array.isArray(categories) ? categories : [],
      Array.isArray(links) ? links : []
    )),
    categories: sortProductCategories(Array.isArray(categories) ? categories : [])
  };
}

async function assertProductSlugUnique(slug, excludeId = '') {
  const query = {
    select: 'id',
    slug: `eq.${slug}`,
    limit: '1'
  };
  if (excludeId) query.id = `neq.${excludeId}`;
  const rows = await supabaseRequest('products', { query });
  if (Array.isArray(rows) && rows.length) throw new Error('Slug už používá jiný výrobek.');
}

async function replaceProductCategoryLinks(productId, categoryIds) {
  assertUuid(productId);
  await supabaseRequest('product_category_links', {
    method: 'DELETE',
    query: { product_id: `eq.${productId}` }
  });
  if (!categoryIds.length) return;
  await supabaseRequest('product_category_links', {
    method: 'POST',
    body: categoryIds.map((categoryId, index) => ({
      product_id: productId,
      category_id: categoryId,
      sort_order: index
    })),
    prefer: 'return=minimal'
  });
}

async function getProductById(id) {
  assertUuid(id);
  const { products } = await listProducts();
  const product = products.find((item) => item.id === id);
  if (!product) throw new Error('Výrobek nebyl nalezen.');
  return product;
}

async function createProduct(input) {
  const { product, categoryIds } = normalizeProductInput(input);
  await assertProductSlugUnique(product.slug);
  const rows = await supabaseRequest('products', {
    method: 'POST',
    body: product,
    prefer: 'return=representation',
    query: { select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,created_at,updated_at' }
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (!created || !created.id) throw new Error('Výrobek se nepodařilo vytvořit.');
  await replaceProductCategoryLinks(created.id, categoryIds);
  return getProductById(created.id);
}

async function updateProduct(id, input) {
  assertUuid(id);
  const { product, categoryIds } = normalizeProductInput(input);
  await assertProductSlugUnique(product.slug, id);
  const rows = await supabaseRequest('products', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,created_at,updated_at'
    },
    body: product,
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Výrobek nebyl nalezen.');
  await replaceProductCategoryLinks(id, categoryIds);
  return getProductById(id);
}

async function archiveProduct(id) {
  assertUuid(id);
  const rows = await supabaseRequest('products', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,created_at,updated_at'
    },
    body: {
      is_visible: false,
      is_published: false,
      published_at: null,
      archived_at: nowIso()
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Výrobek nebyl nalezen.');
  return getProductById(id);
}

async function restoreProduct(id) {
  assertUuid(id);
  const rows = await supabaseRequest('products', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,created_at,updated_at'
    },
    body: {
      archived_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Výrobek nebyl nalezen.');
  return getProductById(id);
}

function normalizeBlogPostPublishedAt(value, status) {
  if (status !== 'published') return null;
  const raw = String(value || '').trim();
  if (!raw) return nowIso();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('Datum publikace není platné.');
  return date.toISOString();
}

function normalizeBlogPostInput(input) {
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const excerpt = String(input.excerpt || '').trim();
  const mainContent = String(input.main_content || input.mainContent || '').trim();
  const authorName = String(input.author_name || input.authorName || '').trim();
  const contentFormat = String(input.content_format || input.contentFormat || 'html').trim();
  const status = String(input.status || 'draft').trim();
  const sortOrderRaw = input.sort_order === undefined ? input.sortOrder : input.sort_order;
  const sortOrder = Number.parseInt(sortOrderRaw === undefined || sortOrderRaw === '' ? '0' : String(sortOrderRaw), 10);

  if (!title) throw new Error('Název článku je povinný.');
  if (!slug) throw new Error('Slug je povinný.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Slug může obsahovat jen malá písmena bez diakritiky, čísla a pomlčky.');
  }
  if (!['html', 'markdown', 'portable_text'].includes(contentFormat)) {
    throw new Error('Formát obsahu není platný.');
  }
  if (!['draft', 'published', 'archived'].includes(status)) {
    throw new Error('Stav článku není platný.');
  }
  if (!Number.isFinite(sortOrder)) throw new Error('Pořadí musí být číslo.');

  return {
    post: {
      title,
      slug,
      excerpt: excerpt || null,
      main_content: mainContent || null,
      content_format: contentFormat,
      photos: normalizeProductPhotos(input.photos),
      author_name: authorName || null,
      status,
      published_at: normalizeBlogPostPublishedAt(input.published_at || input.publishedAt, status),
      sort_order: sortOrder
    },
    categoryIds: normalizeCategoryIds(input.category_ids || input.categoryIds)
  };
}

function sortBlogPosts(posts) {
  return [...posts].sort((a, b) => {
    const aArchived = a.status === 'archived' ? 1 : 0;
    const bArchived = b.status === 'archived' ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
    const aPublished = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bPublished = b.published_at ? new Date(b.published_at).getTime() : 0;
    if (aPublished !== bPublished) return bPublished - aPublished;
    return String(a.title || '').localeCompare(String(b.title || ''), 'cs');
  });
}

function attachBlogCategories(posts, categories, links) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const linksByPost = new Map();
  links.forEach((link) => {
    if (!linksByPost.has(link.blog_post_id)) linksByPost.set(link.blog_post_id, []);
    linksByPost.get(link.blog_post_id).push(link);
  });

  return posts.map((post) => {
    const postLinks = linksByPost.get(post.id) || [];
    const postCategories = postLinks
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((link) => categoryMap.get(link.category_id))
      .filter(Boolean);
    return {
      ...post,
      category_ids: postCategories.map((category) => category.id),
      categories: postCategories
    };
  });
}

async function listBlogPosts() {
  const [posts, categories, links] = await Promise.all([
    supabaseRequest('blog_posts', {
      query: {
        select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,created_at,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('blog_categories', {
      query: {
        select: 'id,title,slug,sort_order,is_visible,archived_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('blog_category_links', {
      query: {
        select: 'blog_post_id,category_id,sort_order',
        order: 'sort_order.asc'
      }
    })
  ]);
  return {
    posts: sortBlogPosts(attachBlogCategories(
      Array.isArray(posts) ? posts : [],
      Array.isArray(categories) ? categories : [],
      Array.isArray(links) ? links : []
    )),
    categories: sortBlogCategories(Array.isArray(categories) ? categories : [])
  };
}

async function assertBlogPostSlugUnique(slug, excludeId = '') {
  const query = {
    select: 'id',
    slug: `eq.${slug}`,
    limit: '1'
  };
  if (excludeId) query.id = `neq.${excludeId}`;
  const rows = await supabaseRequest('blog_posts', { query });
  if (Array.isArray(rows) && rows.length) throw new Error('Slug už používá jiný článek.');
}

async function replaceBlogCategoryLinks(blogPostId, categoryIds) {
  assertUuid(blogPostId);
  await supabaseRequest('blog_category_links', {
    method: 'DELETE',
    query: { blog_post_id: `eq.${blogPostId}` }
  });
  if (!categoryIds.length) return;
  await supabaseRequest('blog_category_links', {
    method: 'POST',
    body: categoryIds.map((categoryId, index) => ({
      blog_post_id: blogPostId,
      category_id: categoryId,
      sort_order: index
    })),
    prefer: 'return=minimal'
  });
}

async function getBlogPostById(id) {
  assertUuid(id);
  const { posts } = await listBlogPosts();
  const post = posts.find((item) => item.id === id);
  if (!post) throw new Error('Článek nebyl nalezen.');
  return post;
}

async function createBlogPost(input) {
  const { post, categoryIds } = normalizeBlogPostInput(input);
  await assertBlogPostSlugUnique(post.slug);
  const rows = await supabaseRequest('blog_posts', {
    method: 'POST',
    body: post,
    prefer: 'return=representation',
    query: { select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,created_at,updated_at' }
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (!created || !created.id) throw new Error('Článek se nepodařilo vytvořit.');
  await replaceBlogCategoryLinks(created.id, categoryIds);
  return getBlogPostById(created.id);
}

async function updateBlogPost(id, input) {
  assertUuid(id);
  const { post, categoryIds } = normalizeBlogPostInput(input);
  await assertBlogPostSlugUnique(post.slug, id);
  const rows = await supabaseRequest('blog_posts', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,created_at,updated_at'
    },
    body: post,
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Článek nebyl nalezen.');
  await replaceBlogCategoryLinks(id, categoryIds);
  return getBlogPostById(id);
}

async function archiveBlogPost(id) {
  assertUuid(id);
  const rows = await supabaseRequest('blog_posts', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,created_at,updated_at'
    },
    body: {
      status: 'archived',
      published_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Článek nebyl nalezen.');
  return getBlogPostById(id);
}

async function restoreBlogPost(id) {
  assertUuid(id);
  const rows = await supabaseRequest('blog_posts', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,created_at,updated_at'
    },
    body: {
      status: 'draft',
      published_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Článek nebyl nalezen.');
  return getBlogPostById(id);
}

function normalizeSiteContentUrl(value, fieldName = 'URL') {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('/')) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`${fieldName} musí začínat /, http:// nebo https://.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${fieldName} musí začínat /, http:// nebo https://.`);
  }
  return url;
}

function normalizeSiteContentImageValue(value) {
  const image = value && typeof value === 'object' ? value : {};
  return {
    url: normalizeSiteContentUrl(image.url || '', 'URL obrázku'),
    alt: String(image.alt || '').trim(),
    caption: String(image.caption || '').trim(),
    media_id: String(image.media_id || image.mediaId || '').trim()
  };
}

function normalizeSiteContentGalleryValue(value) {
  const rawImages = value && typeof value === 'object' && Array.isArray(value.images) ? value.images : [];
  const images = rawImages
    .map((image, index) => {
      const normalized = normalizeSiteContentImageValue(image);
      if (!normalized.url && !normalized.media_id) return null;
      return {
        ...normalized,
        sort_order: index,
        is_featured: index === 0
      };
    })
    .filter(Boolean)
    .map((image, index) => ({
      ...image,
      sort_order: index,
      is_featured: index === 0
    }));
  return { images };
}

function normalizeSiteContentValue(contentType, value) {
  if (contentType === 'json') {
    return value === undefined ? {} : value;
  }
  const rawValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (contentType === 'text') {
    return { text: String(rawValue.text || '').trim() };
  }
  if (contentType === 'rich_text') {
    return { html: String(rawValue.html || rawValue.text || '').trim() };
  }
  if (contentType === 'image') {
    return normalizeSiteContentImageValue(rawValue);
  }
  if (contentType === 'gallery') {
    return normalizeSiteContentGalleryValue(rawValue);
  }
  if (contentType === 'link') {
    return {
      label: String(rawValue.label || '').trim(),
      url: normalizeSiteContentUrl(rawValue.url || '', 'URL odkazu')
    };
  }
  return {};
}

function normalizeSiteContentPublishedAt(value, status) {
  if (status !== 'published') return null;
  const raw = String(value || '').trim();
  if (!raw) return nowIso();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('Datum publikace není platné.');
  return date.toISOString();
}

function normalizeSiteContentInput(input) {
  const locale = String(input.locale || 'cs').trim().toLowerCase();
  const contentKey = String(input.content_key || input.contentKey || '').trim().toLowerCase();
  const section = String(input.section || '').trim().toLowerCase();
  const label = String(input.label || '').trim();
  const contentType = String(input.content_type || input.contentType || 'text').trim();
  const status = String(input.status || 'draft').trim();
  const sortOrderRaw = input.sort_order === undefined ? input.sortOrder : input.sort_order;
  const sortOrder = Number.parseInt(sortOrderRaw === undefined || sortOrderRaw === '' ? '0' : String(sortOrderRaw), 10);

  if (!locale) throw new Error('Jazyk je povinný.');
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) throw new Error('Jazyk musí mít tvar cs nebo cs-cz.');
  if (!contentKey) throw new Error('Klíč obsahu je povinný.');
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(contentKey)) {
    throw new Error('Klíč obsahu může obsahovat jen malá písmena bez diakritiky, čísla, tečky, podtržítka a pomlčky.');
  }
  if (!section) throw new Error('Sekce je povinná.');
  if (!label) throw new Error('Popisek je povinný.');
  if (!['text', 'rich_text', 'image', 'gallery', 'link', 'json'].includes(contentType)) {
    throw new Error('Typ obsahu není platný.');
  }
  if (!['draft', 'published', 'archived'].includes(status)) {
    throw new Error('Stav obsahu není platný.');
  }
  if (!Number.isFinite(sortOrder)) throw new Error('Pořadí musí být číslo.');

  return {
    content_key: contentKey,
    locale,
    section,
    label,
    content_type: contentType,
    value: normalizeSiteContentValue(contentType, input.value),
    status,
    sort_order: sortOrder,
    published_at: normalizeSiteContentPublishedAt(input.published_at || input.publishedAt, status)
  };
}

function sortSiteContent(contents) {
  return [...contents].sort((a, b) => {
    const aArchived = a.status === 'archived' ? 1 : 0;
    const bArchived = b.status === 'archived' ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    if (String(a.section || '') !== String(b.section || '')) {
      return String(a.section || '').localeCompare(String(b.section || ''), 'cs');
    }
    if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
    return String(a.label || '').localeCompare(String(b.label || ''), 'cs');
  });
}

async function listSiteContent() {
  const rows = await supabaseRequest('site_content', {
    query: {
      select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,created_at,updated_at',
      order: 'section.asc,sort_order.asc,label.asc'
    }
  });
  return sortSiteContent(Array.isArray(rows) ? rows : []);
}

function isPublishedAtPublic(value) {
  if (!value) return true;
  const publishedAt = new Date(value).getTime();
  return Number.isFinite(publishedAt) && publishedAt <= Date.now();
}

function isPublicProduct(product) {
  return Boolean(
    product
    && product.is_visible
    && product.is_published
    && !product.archived_at
    && isPublishedAtPublic(product.published_at)
  );
}

function isPublicProductCategory(category) {
  return Boolean(category && category.is_visible && !category.archived_at);
}

function isPublicBlogPost(post) {
  return Boolean(
    post
    && post.status === 'published'
    && isPublishedAtPublic(post.published_at)
  );
}

function isPublicBlogCategory(category) {
  return Boolean(category && category.is_visible && !category.archived_at);
}

function isPublicSiteContentItem(item, locale) {
  return Boolean(
    item
    && item.locale === locale
    && item.status === 'published'
    && isPublishedAtPublic(item.published_at)
  );
}

function collectMediaId(mediaIds, value) {
  if (!value || typeof value !== 'object') return;
  const mediaId = String(value.media_id || value.mediaId || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaId)) {
    mediaIds.add(mediaId);
  }
}

function collectMediaIdsFromPhotos(mediaIds, photos) {
  if (!Array.isArray(photos)) return;
  photos.forEach((photo) => collectMediaId(mediaIds, photo));
}

function collectMediaIdsFromSiteValue(mediaIds, contentType, value) {
  if (!value || typeof value !== 'object') return;
  if (contentType === 'image') collectMediaId(mediaIds, value);
  if (contentType === 'gallery' && Array.isArray(value.images)) {
    value.images.forEach((image) => collectMediaId(mediaIds, image));
  }
}

async function fetchPublicMediaMap(mediaIds) {
  const ids = [...mediaIds];
  if (!ids.length) return new Map();

  const rows = await supabaseRequest('media', {
    query: {
      select: 'id,public_url,alt_text,caption,is_public',
      id: `in.(${ids.join(',')})`
    }
  });

  const mediaMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((media) => {
    if (media && media.is_public !== false && media.public_url) mediaMap.set(media.id, media);
  });
  return mediaMap;
}

function hydratePublicImageRef(image, mediaMap) {
  const source = image && typeof image === 'object' ? image : {};
  const mediaId = String(source.media_id || source.mediaId || '').trim();
  const media = mediaId ? mediaMap.get(mediaId) : null;
  const url = String((media && media.public_url) || source.url || '').trim();
  if (!url) return null;

  return {
    media_id: mediaId || '',
    url,
    alt: String(source.alt || (media && media.alt_text) || '').trim(),
    caption: String(source.caption || (media && media.caption) || '').trim(),
    sort_order: Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : 0,
    is_featured: source.is_featured === true
  };
}

function hydratePublicPhotos(photos, mediaMap) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((photo, index) => hydratePublicImageRef({ ...photo, sort_order: photo.sort_order ?? index }, mediaMap))
    .filter(Boolean)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((photo, index) => ({
      ...photo,
      sort_order: index,
      is_featured: index === 0 || photo.is_featured === true
    }));
}

function hydratePublicSiteValue(item, mediaMap) {
  const value = item.value && typeof item.value === 'object' ? item.value : {};
  if (item.content_type === 'image') return hydratePublicImageRef(value, mediaMap);
  if (item.content_type === 'gallery') {
    const images = Array.isArray(value.images) ? value.images : [];
    return { images: hydratePublicPhotos(images, mediaMap) };
  }
  return value;
}

async function getPublicCmsPayload(locale = 'cs') {
  if (!isSupabaseConfigured()) {
    return { ok: true, configured: false, locale, site_content: {}, products: [], product_categories: [], blog_posts: [], blog_categories: [] };
  }

  const [
    siteContentRows,
    productRows,
    productCategoryRows,
    productLinkRows,
    blogPostRows,
    blogCategoryRows,
    blogLinkRows
  ] = await Promise.all([
    supabaseRequest('site_content', {
      query: {
        select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,updated_at',
        order: 'section.asc,sort_order.asc,label.asc'
      }
    }),
    supabaseRequest('products', {
      query: {
        select: 'id,title,slug,short_description,description,photos,sort_order,is_visible,is_published,published_at,archived_at,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('product_categories', {
      query: {
        select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('product_category_links', {
      query: {
        select: 'product_id,category_id,sort_order',
        order: 'sort_order.asc'
      }
    }),
    supabaseRequest('blog_posts', {
      query: {
        select: 'id,title,slug,excerpt,main_content,content_format,photos,author_name,status,published_at,sort_order,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('blog_categories', {
      query: {
        select: 'id,title,slug,description,image,sort_order,is_visible,archived_at,updated_at',
        order: 'sort_order.asc,title.asc'
      }
    }),
    supabaseRequest('blog_category_links', {
      query: {
        select: 'blog_post_id,category_id,sort_order',
        order: 'sort_order.asc'
      }
    })
  ]);

  const siteContent = sortSiteContent((Array.isArray(siteContentRows) ? siteContentRows : []).filter((item) => isPublicSiteContentItem(item, locale)));
  const products = sortProducts((Array.isArray(productRows) ? productRows : []).filter(isPublicProduct));
  const productCategories = sortProductCategories((Array.isArray(productCategoryRows) ? productCategoryRows : []).filter(isPublicProductCategory));
  const blogPosts = sortBlogPosts((Array.isArray(blogPostRows) ? blogPostRows : []).filter(isPublicBlogPost));
  const blogCategories = sortBlogCategories((Array.isArray(blogCategoryRows) ? blogCategoryRows : []).filter(isPublicBlogCategory));
  const publicProductIds = new Set(products.map((product) => product.id));
  const publicProductCategoryIds = new Set(productCategories.map((category) => category.id));
  const publicBlogPostIds = new Set(blogPosts.map((post) => post.id));
  const publicBlogCategoryIds = new Set(blogCategories.map((category) => category.id));
  const productLinks = (Array.isArray(productLinkRows) ? productLinkRows : []).filter((link) => (
    publicProductIds.has(link.product_id) && publicProductCategoryIds.has(link.category_id)
  ));
  const blogLinks = (Array.isArray(blogLinkRows) ? blogLinkRows : []).filter((link) => (
    publicBlogPostIds.has(link.blog_post_id) && publicBlogCategoryIds.has(link.category_id)
  ));

  const mediaIds = new Set();
  siteContent.forEach((item) => collectMediaIdsFromSiteValue(mediaIds, item.content_type, item.value));
  productCategories.forEach((category) => collectMediaId(mediaIds, category.image));
  products.forEach((product) => collectMediaIdsFromPhotos(mediaIds, product.photos));
  blogCategories.forEach((category) => collectMediaId(mediaIds, category.image));
  blogPosts.forEach((post) => collectMediaIdsFromPhotos(mediaIds, post.photos));
  const mediaMap = await fetchPublicMediaMap(mediaIds);

  const productCategoryMap = new Map(productCategories.map((category) => [category.id, {
    id: category.id,
    title: category.title,
    slug: category.slug,
    description: category.description || '',
    image: hydratePublicImageRef(category.image, mediaMap),
    sort_order: category.sort_order || 0
  }]));
  const blogCategoryMap = new Map(blogCategories.map((category) => [category.id, {
    id: category.id,
    title: category.title,
    slug: category.slug,
    description: category.description || '',
    image: hydratePublicImageRef(category.image, mediaMap),
    sort_order: category.sort_order || 0
  }]));

  const productLinksByProduct = new Map();
  productLinks.forEach((link) => {
    if (!productLinksByProduct.has(link.product_id)) productLinksByProduct.set(link.product_id, []);
    productLinksByProduct.get(link.product_id).push(link);
  });
  const blogLinksByPost = new Map();
  blogLinks.forEach((link) => {
    if (!blogLinksByPost.has(link.blog_post_id)) blogLinksByPost.set(link.blog_post_id, []);
    blogLinksByPost.get(link.blog_post_id).push(link);
  });

  const publicProducts = products.map((product) => {
    const photos = hydratePublicPhotos(product.photos, mediaMap);
    const categories = (productLinksByProduct.get(product.id) || [])
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((link) => productCategoryMap.get(link.category_id))
      .filter(Boolean);
    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      short_description: product.short_description || '',
      description: product.description || '',
      photos,
      featured_image: photos[0] || null,
      categories,
      published_at: product.published_at || null,
      updated_at: product.updated_at || null
    };
  });

  const publicBlogPosts = blogPosts.map((post) => {
    const photos = hydratePublicPhotos(post.photos, mediaMap);
    const categories = (blogLinksByPost.get(post.id) || [])
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((link) => blogCategoryMap.get(link.category_id))
      .filter(Boolean);
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || '',
      main_content: post.main_content || '',
      content_format: post.content_format || 'html',
      photos,
      featured_image: photos[0] || null,
      author_name: post.author_name || '',
      categories,
      published_at: post.published_at || null,
      updated_at: post.updated_at || null
    };
  });

  const publicSiteContent = {};
  siteContent.forEach((item) => {
    publicSiteContent[item.content_key] = {
      id: item.id,
      content_key: item.content_key,
      section: item.section,
      label: item.label,
      content_type: item.content_type,
      value: hydratePublicSiteValue(item, mediaMap),
      sort_order: item.sort_order || 0,
      published_at: item.published_at || null,
      updated_at: item.updated_at || null
    };
  });

  return {
    ok: true,
    configured: true,
    locale,
    site_content: publicSiteContent,
    products: publicProducts,
    product_categories: [...productCategoryMap.values()],
    blog_posts: publicBlogPosts,
    blog_categories: [...blogCategoryMap.values()]
  };
}

async function assertSiteContentKeyUnique(locale, contentKey, excludeId = '') {
  const query = {
    select: 'id',
    locale: `eq.${locale}`,
    content_key: `eq.${contentKey}`,
    limit: '1'
  };
  if (excludeId) query.id = `neq.${excludeId}`;
  const rows = await supabaseRequest('site_content', { query });
  if (Array.isArray(rows) && rows.length) throw new Error('Tento klíč obsahu už pro daný jazyk existuje.');
}

async function createSiteContent(input) {
  const content = normalizeSiteContentInput(input);
  await assertSiteContentKeyUnique(content.locale, content.content_key);
  const rows = await supabaseRequest('site_content', {
    method: 'POST',
    body: content,
    prefer: 'return=representation',
    query: { select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,created_at,updated_at' }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateSiteContent(id, input) {
  assertUuid(id);
  const content = normalizeSiteContentInput(input);
  await assertSiteContentKeyUnique(content.locale, content.content_key, id);
  const rows = await supabaseRequest('site_content', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,created_at,updated_at'
    },
    body: content,
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Obsah nebyl nalezen.');
  return rows[0];
}

async function archiveSiteContent(id) {
  assertUuid(id);
  const rows = await supabaseRequest('site_content', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,created_at,updated_at'
    },
    body: {
      status: 'archived',
      published_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Obsah nebyl nalezen.');
  return rows[0];
}

async function restoreSiteContent(id) {
  assertUuid(id);
  const rows = await supabaseRequest('site_content', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      select: 'id,content_key,locale,section,label,content_type,value,status,sort_order,published_at,created_at,updated_at'
    },
    body: {
      status: 'draft',
      published_at: null
    },
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('Obsah nebyl nalezen.');
  return rows[0];
}

function validateUploadedImage(file) {
  const mimeType = String(file.mime_type || '').toLowerCase();
  const extension = IMAGE_EXTENSIONS[mimeType] || IMAGE_EXTENSIONS[mimeType.split(';')[0]];
  if (!extension) throw new Error('Podporované jsou jen JPG, PNG, WebP nebo GIF obrázky.');
  if (!file.buffer.length) throw new Error('Vyberte obrázek k nahrání.');
  return { mimeType, extension };
}

function persistLocalUploadedImage(file, fields, session) {
  const { mimeType, extension } = validateUploadedImage(file);
  const targetType = fields.targetType || 'site_sections';
  const targetKeySource = fields.targetKey || fields.targetLabel || targetType;
  const targetSlug = slugify(targetKeySource, 'target');
  const originalName = path.basename(file.filename || `image${extension}`);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${slugify(path.basename(originalName, path.extname(originalName)), 'image')}${extension}`;
  const relativeDir = path.join('uploads', targetType, targetSlug);
  const absoluteDir = path.join(ROOT_DIR, relativeDir);
  const storagePath = path.join(relativeDir, filename);
  const absolutePath = path.join(ROOT_DIR, storagePath);

  fs.mkdirSync(absoluteDir, { recursive: true });
  fs.writeFileSync(absolutePath, file.buffer);

  const createdAt = nowIso();
  return {
    id: crypto.randomUUID(),
    bucket: 'local',
    storage_path: storagePath.split(path.sep).join('/'),
    public_url: `/${storagePath.split(path.sep).join('/')}`,
    alt_text: fields.alt || '',
    caption: fields.caption || '',
    mime_type: mimeType,
    size_bytes: file.buffer.length,
    width: null,
    height: null,
    is_public: true,
    metadata: {
      original_name: originalName,
      uploaded_by_email: session.email,
      target_type: targetType,
      target_key: fields.targetKey || '',
      target_label: fields.targetLabel || '',
      sort_order: Number.isFinite(Number(fields.sortOrder)) ? Number(fields.sortOrder) : 0,
      is_featured: fields.isFeatured === true || fields.isFeatured === 'true',
      storage: 'local'
    },
    created_at: createdAt,
    updated_at: createdAt
  };
}

async function persistSupabaseUploadedImage(file, fields, session) {
  const { mimeType, extension } = validateUploadedImage(file);
  const targetType = fields.targetType || 'site_sections';
  const bucket = mediaBucketForTargetType(targetType);
  const targetSlug = slugify(fields.targetKey || fields.targetLabel || targetType, 'target');
  const originalName = path.basename(file.filename || `image${extension}`);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${slugify(path.basename(originalName, path.extname(originalName)), 'image')}${extension}`;
  const storagePath = `${targetSlug}/${filename}`;
  const createdAt = nowIso();
  const media = {
    id: crypto.randomUUID(),
    bucket,
    storage_path: storagePath,
    public_url: publicSupabaseStorageUrl(bucket, storagePath),
    alt_text: fields.alt || '',
    caption: fields.caption || '',
    mime_type: mimeType,
    size_bytes: file.buffer.length,
    width: null,
    height: null,
    is_public: true,
    metadata: {
      original_name: originalName,
      uploaded_by_email: session.email,
      target_type: targetType,
      target_key: fields.targetKey || '',
      target_label: fields.targetLabel || '',
      sort_order: Number.isFinite(Number(fields.sortOrder)) ? Number(fields.sortOrder) : 0,
      is_featured: fields.isFeatured === true || fields.isFeatured === 'true',
      storage: 'supabase'
    },
    created_at: createdAt,
    updated_at: createdAt
  };

  await uploadSupabaseStorageObject(bucket, storagePath, file);
  let rows;
  try {
    rows = await supabaseRequest('media', {
      method: 'POST',
      body: media,
      prefer: 'return=representation',
      query: {
        select: 'id,bucket,storage_path,public_url,alt_text,caption,mime_type,size_bytes,width,height,is_public,metadata,created_at,updated_at'
      }
    });
  } catch (error) {
    deleteSupabaseStorageObject(media).catch((deleteError) => {
      console.error('Failed to clean up Supabase upload after media insert error:', deleteError);
    });
    throw error;
  }

  return Array.isArray(rows) && rows[0] ? rows[0] : media;
}

async function persistUploadedImage(file, fields, session) {
  return isSupabaseConfigured()
    ? persistSupabaseUploadedImage(file, fields, session)
    : persistLocalUploadedImage(file, fields, session);
}

async function handleMediaUpload(req, res, session) {
  try {
    const { fields, files } = await parseMultipart(req);
    const image = files.image;
    if (!image) throw new Error('Vyberte obrázek k nahrání.');

    const db = await getMediaDb();
    const targetType = fields.targetType || 'site_sections';
    const target = getTarget(db, targetType, fields.targetKey, fields.targetLabel);
    const replaceMediaId = fields.replaceMediaId || '';
    const replaceIndex = replaceMediaId
      ? target.images.findIndex((entry) => entry.media_id === replaceMediaId)
      : -1;
    const mediaIndex = replaceIndex !== -1 ? replaceIndex : (targetType === 'site_sections' ? 0 : target.images.length);
    const mediaFields = {
      ...fields,
      targetType,
      targetKey: target.key,
      targetLabel: target.label || fields.targetLabel || target.key,
      sortOrder: mediaIndex,
      isFeatured: mediaIndex === 0
    };
    const media = await persistUploadedImage(image, mediaFields, session);
    const photo = createPhotoRef(media, mediaIndex);
    photo.alt = fields.alt || target.label || '';
    photo.caption = fields.caption || '';

    db.media.push(media);
    if (replaceIndex !== -1) {
      const [oldPhoto] = target.images.splice(replaceIndex, 1, photo);
      await deleteUnreferencedMedia(db, oldPhoto.media_id);
    } else if (targetType === 'site_sections') {
      const oldImages = target.images.splice(0, target.images.length, photo);
      for (const oldPhoto of oldImages) {
        await deleteUnreferencedMedia(db, oldPhoto.media_id);
      }
    } else {
      target.images.push(photo);
    }

    updateImageOrdering(target.images);
    if (!isSupabaseConfigured()) writeMediaDb(db);
    sendJson(res, 201, { ok: true, media, target });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Nahrání se nepodařilo.' });
  }
}

async function handleMediaDelete(req, res) {
  try {
    const body = await parseJsonBody(req);
    const db = await getMediaDb();
    const targetType = body.targetType;
    const targetKey = body.targetKey;
    const mediaId = body.mediaId;
    if (!TARGET_TYPES[targetType] || !targetKey || !mediaId) {
      throw new Error('Chybí údaje pro smazání fotky.');
    }

    const target = db.targets[targetType] && db.targets[targetType][targetKey];
    if (!target || !Array.isArray(target.images)) throw new Error('Položka nebyla nalezena.');

    const before = target.images.length;
    target.images = target.images.filter((image) => image.media_id !== mediaId);
    if (target.images.length === before) throw new Error('Fotka nebyla nalezena.');
    updateImageOrdering(target.images);

    await deleteUnreferencedMedia(db, mediaId);

    if (!isSupabaseConfigured()) writeMediaDb(db);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Smazání se nepodařilo.' });
  }
}

async function handleProductPhotoUpload(req, res, session) {
  try {
    const { fields, files } = await parseMultipart(req);
    const image = files.image;
    if (!image) throw new Error('Vyberte obrázek k nahrání.');

    const db = await getMediaDb();
    const targetFields = {
      ...fields,
      targetType: 'products',
      targetKey: slugify(fields.targetKey || fields.targetLabel || 'vyrobek', 'vyrobek'),
      targetLabel: fields.targetLabel || fields.targetKey || 'Výrobek'
    };
    const target = getTarget(db, 'products', targetFields.targetKey, targetFields.targetLabel);
    const mediaFields = {
      ...targetFields,
      targetKey: target.key,
      targetLabel: target.label || targetFields.targetLabel,
      sortOrder: target.images.length,
      isFeatured: target.images.length === 0
    };
    const media = await persistUploadedImage(image, mediaFields, session);
    const photo = createPhotoRef(media, target.images.length);
    photo.alt = fields.alt || target.label || '';
    photo.caption = fields.caption || '';
    target.images.push(photo);
    db.media.push(media);
    updateImageOrdering(target.images);
    if (!isSupabaseConfigured()) writeMediaDb(db);
    sendJson(res, 201, { ok: true, media, photo, target });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Nahrání se nepodařilo.' });
  }
}

async function handleBlogPostPhotoUpload(req, res, session) {
  try {
    const { fields, files } = await parseMultipart(req);
    const image = files.image;
    if (!image) throw new Error('Vyberte obrázek k nahrání.');

    const db = await getMediaDb();
    const targetFields = {
      ...fields,
      targetType: 'blog_posts',
      targetKey: slugify(fields.targetKey || fields.targetLabel || 'clanek', 'clanek'),
      targetLabel: fields.targetLabel || fields.targetKey || 'Článek'
    };
    const target = getTarget(db, 'blog_posts', targetFields.targetKey, targetFields.targetLabel);
    const mediaFields = {
      ...targetFields,
      targetKey: target.key,
      targetLabel: target.label || targetFields.targetLabel,
      sortOrder: target.images.length,
      isFeatured: target.images.length === 0
    };
    const media = await persistUploadedImage(image, mediaFields, session);
    const photo = createPhotoRef(media, target.images.length);
    photo.alt = fields.alt || target.label || '';
    photo.caption = fields.caption || '';
    target.images.push(photo);
    db.media.push(media);
    updateImageOrdering(target.images);
    if (!isSupabaseConfigured()) writeMediaDb(db);
    sendJson(res, 201, { ok: true, media, photo, target });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Nahrání se nepodařilo.' });
  }
}

async function handleSiteContentPhotoUpload(req, res, session) {
  try {
    const { fields, files } = await parseMultipart(req);
    const image = files.image;
    if (!image) throw new Error('Vyberte obrázek k nahrání.');

    const db = await getMediaDb();
    const targetFields = {
      ...fields,
      targetType: 'site_sections',
      targetKey: slugify(fields.targetKey || fields.targetLabel || 'sekce-webu', 'sekce-webu'),
      targetLabel: fields.targetLabel || fields.targetKey || 'Sekce webu'
    };
    const target = getTarget(db, 'site_sections', targetFields.targetKey, targetFields.targetLabel);
    const mediaFields = {
      ...targetFields,
      targetKey: target.key,
      targetLabel: target.label || targetFields.targetLabel,
      sortOrder: target.images.length,
      isFeatured: target.images.length === 0
    };
    const media = await persistUploadedImage(image, mediaFields, session);
    const photo = createPhotoRef(media, target.images.length);
    photo.alt = fields.alt || target.label || '';
    photo.caption = fields.caption || '';

    target.images.push(photo);
    db.media.push(media);
    updateImageOrdering(target.images);
    if (!isSupabaseConfigured()) writeMediaDb(db);
    sendJson(res, 201, { ok: true, media, photo, target });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Nahrání se nepodařilo.' });
  }
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT_DIR, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(ROOT_DIR + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      send(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleAdmin(req, res, url) {
  const session = getSession(req);

  if (url.pathname === '/admin/login' && req.method === 'GET') {
    if (session) {
      redirect(res, '/admin');
      return;
    }
    send(res, 200, loginPage({ next: url.searchParams.get('next') || '/admin' }), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/auth/google' && req.method === 'GET') {
    if (session) {
      redirect(res, '/admin');
      return;
    }

    const next = getSafeAdminNext(url.searchParams.get('next') || '/admin');
    if (!isAuthConfigured()) {
      send(res, 500, loginPage({ error: 'Google přihlášení není nakonfigurované.', next }), {
        'Cache-Control': 'no-store'
      });
      return;
    }

    const auth = buildGoogleAuthUrl(req, next);
    redirect(res, auth.url, {
      'Set-Cookie': oauthStateCookie(auth.token, req)
    });
    return;
  }

  if (url.pathname === '/admin/oauth/google/callback' && req.method === 'GET') {
    const callbackState = url.searchParams.get('state') || '';
    const storedState = getOauthState(req, callbackState);

    if (!callbackState || !storedState) {
      send(res, 400, loginPage({ error: 'Přihlášení vypršelo. Zkuste to znovu.' }), {
        'Cache-Control': 'no-store',
        'Set-Cookie': expiredOauthStateCookie()
      });
      return;
    }

    if (url.searchParams.get('error')) {
      send(res, 401, loginPage({ error: 'Google přihlášení bylo zrušeno.', next: storedState.next }), {
        'Cache-Control': 'no-store',
        'Set-Cookie': expiredOauthStateCookie()
      });
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      send(res, 400, loginPage({ error: 'Google neposlal přihlašovací kód.', next: storedState.next }), {
        'Cache-Control': 'no-store',
        'Set-Cookie': expiredOauthStateCookie()
      });
      return;
    }

    try {
      const token = await requestGoogleToken(req, code);
      const user = await requestGoogleUser(token.access_token);
      const email = String(user.email || '').toLowerCase();
      const emailVerified = user.email_verified === true || user.email_verified === 'true';

      if (!emailVerified || !safeEqual(email, GOOGLE_ALLOWED_EMAIL)) {
        send(res, 403, loginPage({ error: 'Tento Google účet nemá přístup do administrace.', next: storedState.next }), {
          'Cache-Control': 'no-store',
          'Set-Cookie': expiredOauthStateCookie()
        });
        return;
      }

      const cookieValue = createSession(email);
      redirect(res, storedState.next, {
        'Set-Cookie': [
          sessionCookie(cookieValue, req),
          expiredOauthStateCookie()
        ]
      });
    } catch (error) {
      console.error(error);
      send(res, 502, loginPage({ error: 'Google přihlášení se nepodařilo dokončit.', next: storedState.next }), {
        'Cache-Control': 'no-store',
        'Set-Cookie': expiredOauthStateCookie()
      });
    }
    return;
  }

  if (url.pathname === '/admin/logout' && req.method === 'POST') {
    redirect(res, '/admin/login', {
      'Set-Cookie': expiredSessionCookie()
    });
    return;
  }

  if (url.pathname === '/admin/logout') {
    send(res, 405, 'Method not allowed', { Allow: 'POST' });
    return;
  }

  if (!session) {
    redirect(res, `/admin/login?next=${encodeURIComponent(url.pathname)}`);
    return;
  }

  if (url.pathname === '/admin/api/media' && req.method === 'GET') {
    try {
      sendJson(res, 200, await getMediaDb(), {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/media/upload' && req.method === 'POST') {
    await handleMediaUpload(req, res, session);
    return;
  }

  if (url.pathname === '/admin/api/media/delete' && req.method === 'POST') {
    await handleMediaDelete(req, res);
    return;
  }

  if (url.pathname === '/admin/api/site-content' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, contents: await listSiteContent() }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/site-content' && req.method === 'POST') {
    try {
      const content = await createSiteContent(await parseJsonBody(req));
      sendJson(res, 201, { ok: true, content }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/site-content/photo-upload' && req.method === 'POST') {
    await handleSiteContentPhotoUpload(req, res, session);
    return;
  }

  const siteContentMatch = url.pathname.match(/^\/admin\/api\/site-content\/([^/]+)$/);
  if (siteContentMatch && req.method === 'PATCH') {
    try {
      const content = await updateSiteContent(decodeURIComponent(siteContentMatch[1]), await parseJsonBody(req));
      sendJson(res, 200, { ok: true, content }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const siteContentActionMatch = url.pathname.match(/^\/admin\/api\/site-content\/([^/]+)\/(archive|restore)$/);
  if (siteContentActionMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(siteContentActionMatch[1]);
      const content = siteContentActionMatch[2] === 'restore'
        ? await restoreSiteContent(id)
        : await archiveSiteContent(id);
      sendJson(res, 200, { ok: true, content }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/products' && req.method === 'GET') {
    try {
      const data = await listProducts();
      sendJson(res, 200, { ok: true, ...data }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/products' && req.method === 'POST') {
    try {
      const product = await createProduct(await parseJsonBody(req));
      sendJson(res, 201, { ok: true, product }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/products/photo-upload' && req.method === 'POST') {
    await handleProductPhotoUpload(req, res, session);
    return;
  }

  if (url.pathname === '/admin/api/blog-posts' && req.method === 'GET') {
    try {
      const data = await listBlogPosts();
      sendJson(res, 200, { ok: true, ...data }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/blog-posts' && req.method === 'POST') {
    try {
      const post = await createBlogPost(await parseJsonBody(req));
      sendJson(res, 201, { ok: true, post }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/blog-posts/photo-upload' && req.method === 'POST') {
    await handleBlogPostPhotoUpload(req, res, session);
    return;
  }

  const blogPostMatch = url.pathname.match(/^\/admin\/api\/blog-posts\/([^/]+)$/);
  if (blogPostMatch && req.method === 'PATCH') {
    try {
      const post = await updateBlogPost(decodeURIComponent(blogPostMatch[1]), await parseJsonBody(req));
      sendJson(res, 200, { ok: true, post }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const blogPostActionMatch = url.pathname.match(/^\/admin\/api\/blog-posts\/([^/]+)\/(archive|restore)$/);
  if (blogPostActionMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(blogPostActionMatch[1]);
      const post = blogPostActionMatch[2] === 'restore'
        ? await restoreBlogPost(id)
        : await archiveBlogPost(id);
      sendJson(res, 200, { ok: true, post }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const productMatch = url.pathname.match(/^\/admin\/api\/products\/([^/]+)$/);
  if (productMatch && req.method === 'PATCH') {
    try {
      const product = await updateProduct(decodeURIComponent(productMatch[1]), await parseJsonBody(req));
      sendJson(res, 200, { ok: true, product }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const productActionMatch = url.pathname.match(/^\/admin\/api\/products\/([^/]+)\/(archive|restore)$/);
  if (productActionMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(productActionMatch[1]);
      const product = productActionMatch[2] === 'restore'
        ? await restoreProduct(id)
        : await archiveProduct(id);
      sendJson(res, 200, { ok: true, product }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/product-categories' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, categories: await listProductCategories() }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/product-categories' && req.method === 'POST') {
    try {
      const category = await createProductCategory(await parseJsonBody(req));
      sendJson(res, 201, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const productCategoryMatch = url.pathname.match(/^\/admin\/api\/product-categories\/([^/]+)$/);
  if (productCategoryMatch && req.method === 'PATCH') {
    try {
      const category = await updateProductCategory(decodeURIComponent(productCategoryMatch[1]), await parseJsonBody(req));
      sendJson(res, 200, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const productCategoryActionMatch = url.pathname.match(/^\/admin\/api\/product-categories\/([^/]+)\/(archive|restore)$/);
  if (productCategoryActionMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(productCategoryActionMatch[1]);
      const category = productCategoryActionMatch[2] === 'restore'
        ? await restoreProductCategory(id)
        : await archiveProductCategory(id);
      sendJson(res, 200, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/blog-categories' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, categories: await listBlogCategories() }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if (url.pathname === '/admin/api/blog-categories' && req.method === 'POST') {
    try {
      const category = await createBlogCategory(await parseJsonBody(req));
      sendJson(res, 201, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const blogCategoryMatch = url.pathname.match(/^\/admin\/api\/blog-categories\/([^/]+)$/);
  if (blogCategoryMatch && req.method === 'PATCH') {
    try {
      const category = await updateBlogCategory(decodeURIComponent(blogCategoryMatch[1]), await parseJsonBody(req));
      sendJson(res, 200, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  const blogCategoryActionMatch = url.pathname.match(/^\/admin\/api\/blog-categories\/([^/]+)\/(archive|restore)$/);
  if (blogCategoryActionMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(blogCategoryActionMatch[1]);
      const category = blogCategoryActionMatch[2] === 'restore'
        ? await restoreBlogCategory(id)
        : await archiveBlogCategory(id);
      sendJson(res, 200, { ok: true, category }, {
        'Cache-Control': 'no-store'
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: normalizeSupabaseError(error) }, {
        'Cache-Control': 'no-store'
      });
    }
    return;
  }

  if ((url.pathname === '/admin' || url.pathname === '/admin/') && req.method === 'GET') {
    send(res, 200, dashboardPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/media' && req.method === 'GET') {
    send(res, 200, mediaAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/site-content' && req.method === 'GET') {
    send(res, 200, siteContentAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/product-categories' && req.method === 'GET') {
    send(res, 200, productCategoriesAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/products' && req.method === 'GET') {
    send(res, 200, productsAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/blog-categories' && req.method === 'GET') {
    send(res, 200, blogCategoriesAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (url.pathname === '/admin/blog-posts' && req.method === 'GET') {
    send(res, 200, blogPostsAdminPage(session), {
      'Cache-Control': 'no-store'
    });
    return;
  }

  send(res, 404, adminLayout('Nenalezeno', `
    <div class="masthead">
      <div class="brand">
        <img src="/logo.jpg" alt="Dřevito">
        <div>
          <strong>Dřevito</strong>
          <span>Administrace webu</span>
        </div>
      </div>
      <a class="button button--ghost" href="/admin">Dashboard</a>
    </div>
    <div class="content">
      <h1>Stránka nenalezena</h1>
      <p>Tato admin stránka zatím neexistuje.</p>
    </div>
  `), {
    'Cache-Control': 'no-store'
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/media-targets' && req.method === 'GET') {
    getPublicMediaTargets()
      .then((targets) => {
        sendJson(res, 200, targets, {
          'Cache-Control': 'no-cache'
        });
      })
      .catch((error) => {
        console.error(error);
        sendJson(res, 500, { ok: false, error: 'Media targets could not be loaded.' }, {
          'Cache-Control': 'no-store'
        });
      });
    return;
  }

  if (url.pathname === '/api/public-content' && req.method === 'GET') {
    getPublicCmsPayload((url.searchParams.get('locale') || 'cs').trim().toLowerCase())
      .then((payload) => {
        sendJson(res, 200, payload, {
          'Cache-Control': 'no-cache'
        });
      })
      .catch((error) => {
        console.error(error);
        sendJson(res, 500, {
          ok: false,
          configured: isSupabaseConfigured(),
          error: 'Public CMS content could not be loaded.'
        }, {
          'Cache-Control': 'no-store'
        });
      });
    return;
  }

  if (url.pathname.startsWith('/admin')) {
    handleAdmin(req, res, url).catch((error) => {
      console.error(error);
      send(res, 500, 'Internal server error');
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  serveStatic(req, res, url.pathname);
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Drevito site running at http://localhost:${PORT}`);
    console.log(`Admin login: http://localhost:${PORT}/admin/login`);
    if (!isAuthConfigured()) {
      console.warn('Google admin login is disabled until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_ALLOWED_EMAIL are set.');
    }
    if (!process.env.SESSION_SECRET) {
      console.warn('SESSION_SECRET is not set. A temporary secret was generated for this process.');
    }
  });
}

module.exports = handleRequest;
