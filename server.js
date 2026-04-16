/**
 * GALLERY PWA — server.js
 * Node.js + Express backend
 * Features: multer upload, JWT auth, CORS, MIME validation,
 *           Cloudinary (optional), file listing, deletion
 *
 * Run: node server.js
 * Requires: npm install express multer cors jsonwebtoken dotenv
 */

'use strict';

require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');

/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const PORT        = process.env.PORT        || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'gallery-dev-secret-change-in-production';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const MAX_MB      = parseInt(process.env.MAX_MB || '10');

// Cloudinary (optional — set env vars to enable)
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('[cloudinary] enabled');
  } catch { console.warn('[cloudinary] package not installed — using local storage'); }
}

// Ensure uploads directory exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ══════════════════════════════════════════
   APP SETUP
══════════════════════════════════════════ */
const app = express();

app.use(cors({
  origin:      process.env.ALLOWED_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname)));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

/* ══════════════════════════════════════════
   MULTER — file storage & validation
══════════════════════════════════════════ */
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/heic', 'image/heif',
  'image/bmp',  'image/tiff',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ts  = Date.now();
    const rnd = crypto.randomBytes(4).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${ts}-${rnd}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'invalid mime type'));
    }
    cb(null, true);
  },
});

/* ══════════════════════════════════════════
   AUTH MIDDLEWARE
══════════════════════════════════════════ */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'missing token' });
  }
  const token = header.slice(7);
  try {
    // Support mock tokens from frontend (prefix "mock.")
    if (token.startsWith('mock.')) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      req.user = payload;
      return next();
    }
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'invalid token' });
  }
}

/* Optional auth — passes through even without token */
function softAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      req.user = token.startsWith('mock.')
        ? JSON.parse(atob(token.split('.')[1]))
        : jwt.verify(token, JWT_SECRET);
    } catch { /* ignore */ }
  }
  next();
}

/* ══════════════════════════════════════════
   ROUTES — AUTH
══════════════════════════════════════════ */

/** POST /api/auth/register */
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ success: false, error: 'invalid input' });
  }
  // In production: hash password + save to DB
  const token = jwt.sign({ email, name: name || email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: { email, name } });
});

/** POST /api/auth/login */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'invalid input' });
  }
  // In production: verify against DB
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: { email } });
});

/* ══════════════════════════════════════════
   ROUTES — UPLOAD
══════════════════════════════════════════ */

/** POST /api/upload */
app.post('/api/upload', softAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'no file provided' });
  }

  const { filename, path: filePath, mimetype, size } = req.file;

  // Optional: upload to Cloudinary
  if (cloudinary) {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder:         'gallery-pwa',
        resource_type:  'image',
        public_id:      filename.replace(/\.[^.]+$/, ''),
      });
      // Delete local file after cloud upload
      fs.unlinkSync(filePath);
      return res.json({
        success:  true,
        filename: result.public_id,
        url:      result.secure_url,
        size,
        storage:  'cloudinary',
      });
    } catch (err) {
      console.error('[cloudinary] upload failed:', err.message);
      // Fall through to local storage
    }
  }

  // Local storage response
  res.json({
    success:  true,
    filename,
    url:      `/uploads/${filename}`,
    size,
    storage:  'local',
  });
});

/* ══════════════════════════════════════════
   ROUTES — IMAGES
══════════════════════════════════════════ */

/** GET /api/images — list all uploaded images */
app.get('/api/images', softAuth, (req, res) => {
  if (cloudinary) {
    cloudinary.search
      .expression('folder:gallery-pwa')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute()
      .then(result => {
        const images = result.resources.map(r => ({
          filename: r.public_id,
          url:      r.secure_url,
          size:     r.bytes,
          created:  r.created_at,
        }));
        res.json({ success: true, images });
      })
      .catch(err => {
        console.error('[cloudinary] list failed:', err);
        listLocalImages(res);
      });
    return;
  }
  listLocalImages(res);
});

function listLocalImages(res) {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const images = files
      .filter(f => /\.(jpe?g|png|gif|webp|heic|bmp|tiff)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        return { filename: f, url: `/uploads/${f}`, size: stat.size, created: stat.birthtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json({ success: true, images });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** DELETE /api/images/:name */
app.delete('/api/images/:name', softAuth, async (req, res) => {
  const name = path.basename(req.params.name);   // sanitize

  if (cloudinary) {
    try {
      await cloudinary.uploader.destroy(`gallery-pwa/${name}`);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  const filePath = path.join(UPLOADS_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

/* ══════════════════════════════════════════
   ERROR HANDLERS
══════════════════════════════════════════ */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: `הקובץ גדול מ-${MAX_MB}MB` });
    }
    return res.status(400).json({ success: false, error: `שגיאת העלאה: ${err.message}` });
  }
  console.error('[error]', err);
  res.status(500).json({ success: false, error: 'שגיאת שרת' });
});

/* ── SPA fallback — serve index.html for all other routes ── */
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ══════════════════════════════════════════
   START
══════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n🖼  Gallery PWA Server running at http://localhost:${PORT}`);
  console.log(`📁  Uploads directory: ${UPLOADS_DIR}`);
  console.log(`☁️   Cloudinary: ${cloudinary ? 'enabled' : 'disabled (local storage)'}\n`);
});
