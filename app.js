/**
 * GALLERY PWA — app.js
 * Features: Auth (JWT mock), Upload queue, Retry, Compression,
 *           Resume, Background Sync, Share API, localStorage session
 */

'use strict';

/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const CFG = {
  UPLOAD_URL:   '/api/upload',
  IMAGES_URL:   '/api/images',
  CONCURRENCY:  3,          // parallel uploads
  MAX_RETRIES:  3,
  RETRY_BASE:   800,        // ms base for exponential backoff
  MAX_WIDTH:    1920,
  QUALITY:      0.7,
  MAX_MB:       10,
  SESSION_KEY:  'gallery_session',
  QUEUE_KEY:    'gallery_queue',
  TOKEN_KEY:    'gallery_jwt',
};

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
const state = {
  token:     null,
  user:      null,
  queue:     [],          // [{id, file, name, size, status, retries, url}]
  filter:    'all',
  running:   false,
  deferredInstall: null,
};

/* ══════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const dom = {
  screenAuth:     $('screen-auth'),
  screenApp:      $('screen-app'),
  authForm:       $('auth-form'),
  authEmail:      $('auth-email'),
  authPassword:   $('auth-password'),
  authName:       $('auth-name'),
  authSubmit:     $('auth-submit'),
  authError:      $('auth-error'),
  fieldName:      $('field-name'),
  authTabs:       $('auth-tabs'),
  fileInput:      $('file-input'),
  btnPick:        $('btn-pick'),
  btnResume:      $('btn-resume'),
  btnClear:       $('btn-clear'),
  btnGallery:     $('btn-gallery'),
  btnLogout:      $('btn-logout'),
  fileList:       $('file-list'),
  fileListHeader: $('file-list-header'),
  emptyState:     $('empty-state'),
  overallProg:    $('overall-progress'),
  progressFill:   $('progress-fill'),
  progressLabel:  $('progress-label'),
  progressPct:    $('progress-pct'),
  statTotal:      $('stat-total'),
  statDone:       $('stat-done'),
  statFail:       $('stat-fail'),
  statSize:       $('stat-size'),
  offlineBanner:  $('offline-banner'),
  modalGallery:   $('modal-gallery'),
  modalClose:     $('modal-close'),
  galleryGrid:    $('gallery-grid'),
  installBanner:  $('install-banner'),
  btnInstall:     $('btn-install'),
  btnInstallDis:  $('btn-install-dismiss'),
};

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  bindEvents();
  checkOnlineStatus();
  restoreSession();
});

/* ── Service Worker ── */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    console.log('[SW] registered');
    // Listen for background sync messages
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SYNC_DONE') refreshQueue();
    });
  } catch (err) {
    console.warn('[SW] failed:', err);
  }
}

/* ── PWA Install ── */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.deferredInstall = e;
  dom.installBanner.classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  dom.installBanner.classList.add('hidden');
});

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
let authMode = 'login';

function restoreSession() {
  const raw = localStorage.getItem(CFG.SESSION_KEY);
  if (!raw) return showAuth();
  try {
    const s = JSON.parse(raw);
    if (!s.token || !s.user) return showAuth();
    state.token = s.token;
    state.user  = s.user;
    showApp();
  } catch { showAuth(); }
}

function showAuth() {
  dom.screenAuth.classList.add('active');
  dom.screenApp.classList.remove('active');
}
function showApp() {
  dom.screenAuth.classList.remove('active');
  dom.screenApp.classList.add('active');
  loadSavedQueue();
}

/** Mock JWT auth — replace with real backend call */
async function doAuth(email, password, name) {
  // Simulate network delay
  await sleep(600);
  if (password.length < 6) throw new Error('הסיסמה קצרה מדי (מינ׳ 6 תווים)');
  // Generate a mock token
  const payload = btoa(JSON.stringify({ email, name: name || email.split('@')[0], iat: Date.now() }));
  const token   = `mock.${payload}.sig`;
  return { token, user: { email, name: name || email.split('@')[0] } };
}

/* ── Bind auth events ── */
function bindAuth() {
  // Tab switch
  dom.authTabs.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    authMode = tab.dataset.tab;
    dom.authTabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    dom.fieldName.classList.toggle('hidden', authMode !== 'register');
    dom.authSubmit.textContent = authMode === 'login' ? 'כניסה' : 'הרשמה';
    dom.authError.classList.add('hidden');
  });

  dom.authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = dom.authEmail.value.trim();
    const password = dom.authPassword.value;
    const name     = dom.authName.value.trim();
    dom.authError.classList.add('hidden');
    dom.authSubmit.textContent = '...';
    dom.authSubmit.disabled = true;
    try {
      const { token, user } = await doAuth(email, password, authMode === 'register' ? name : undefined);
      state.token = token;
      state.user  = user;
      localStorage.setItem(CFG.SESSION_KEY, JSON.stringify({ token, user }));
      showApp();
    } catch (err) {
      dom.authError.textContent = err.message;
      dom.authError.classList.remove('hidden');
    } finally {
      dom.authSubmit.disabled = false;
      dom.authSubmit.textContent = authMode === 'login' ? 'כניסה' : 'הרשמה';
    }
  });
}

/* ══════════════════════════════════════════
   BIND ALL EVENTS
══════════════════════════════════════════ */
function bindEvents() {
  bindAuth();

  // File pick
  dom.btnPick.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', e => handleFileSelection(e.target.files));

  // Resume
  dom.btnResume.addEventListener('click', startUploadQueue);

  // Clear
  dom.btnClear.addEventListener('click', clearAll);

  // Logout
  dom.btnLogout.addEventListener('click', logout);

  // Gallery modal
  dom.btnGallery.addEventListener('click', openGallery);
  dom.modalClose.addEventListener('click', closeGallery);

  // Install
  dom.btnInstall.addEventListener('click', installApp);
  dom.btnInstallDis.addEventListener('click', () => dom.installBanner.classList.add('hidden'));

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      applyFilter();
    });
  });

  // Online/offline
  window.addEventListener('online',  () => { updateOnlineBanner(true);  if (hasPendingUploads()) startUploadQueue(); });
  window.addEventListener('offline', () => updateOnlineBanner(false));
}

/* ══════════════════════════════════════════
   FILE HANDLING
══════════════════════════════════════════ */
async function handleFileSelection(files) {
  if (!files?.length) return;

  const newItems = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > CFG.MAX_MB * 1024 * 1024) {
      showToast(`${file.name} גדול מ-${CFG.MAX_MB}MB — דולג`);
      continue;
    }
    // Skip already queued
    if (state.queue.find(q => q.name === file.name && q.size === file.size)) continue;

    const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    newItems.push({ id, file, name: file.name, size: file.size, status: 'pending', retries: 0, url: null });
  }

  if (!newItems.length) return;
  state.queue.push(...newItems);
  dom.fileInput.value = '';   // reset so same files can be re-selected

  renderAll();
  updateStats();
  saveQueueToStorage();
  startUploadQueue();
}

/* ══════════════════════════════════════════
   IMAGE COMPRESSION
══════════════════════════════════════════ */
function compressImage(file) {
  return new Promise(resolve => {
    const img  = new Image();
    const burl = URL.createObjectURL(file);
    img.onload = () => {
      // Calculate dimensions
      let { width, height } = img;
      if (width > CFG.MAX_WIDTH) {
        height = Math.round((height * CFG.MAX_WIDTH) / width);
        width  = CFG.MAX_WIDTH;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Release blob URL immediately
      URL.revokeObjectURL(burl);

      canvas.toBlob(blob => {
        // If compression made it bigger, use original
        resolve(blob && blob.size < file.size ? blob : file);
      }, 'image/jpeg', CFG.QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(burl); resolve(file); };
    img.src = burl;
  });
}

/* ══════════════════════════════════════════
   UPLOAD QUEUE — concurrency limiter
══════════════════════════════════════════ */
async function startUploadQueue() {
  if (state.running) return;
  state.running = true;

  const pending = state.queue.filter(q => q.status === 'pending' || q.status === 'failed');
  if (!pending.length) { state.running = false; return; }

  // Update all pending statuses
  showProgress(true);

  // Concurrency pool
  const pool = [];
  let idx = 0;

  async function runNext() {
    while (idx < pending.length) {
      const item = pending[idx++];
      if (item.status === 'done') continue;        // skip already done
      item.status  = 'pending';
      item.retries = 0;
      await uploadWithRetry(item);
      updateStats();
      saveQueueToStorage();
    }
  }

  for (let i = 0; i < CFG.CONCURRENCY; i++) pool.push(runNext());
  await Promise.all(pool);

  state.running = false;
  finalizeProgress();
}

async function uploadWithRetry(item) {
  for (let attempt = 0; attempt <= CFG.MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        item.status = 'pending';
        updateItemDOM(item);
        await sleep(CFG.RETRY_BASE * Math.pow(2, attempt - 1));  // exponential backoff
      }

      await uploadFile(item);
      return;   // success

    } catch (err) {
      item.retries = attempt + 1;
      if (attempt === CFG.MAX_RETRIES) {
        item.status = 'failed';
        updateItemDOM(item);
        console.warn(`[upload] failed after ${CFG.MAX_RETRIES + 1} attempts:`, item.name);
      }
    }
  }
}

async function uploadFile(item) {
  item.status = 'uploading';
  updateItemDOM(item);

  // Compress before upload
  const blob = await compressImage(item.file);

  const formData = new FormData();
  formData.append('image', blob, item.name);
  formData.append('userId', state.user?.email || 'anonymous');

  const response = await fetch(CFG.UPLOAD_URL, {
    method: 'POST',
    headers: {
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'server error');

  item.status = 'done';
  item.url    = data.url;
  updateItemDOM(item);
  updateOverallProgress();
}

/* ══════════════════════════════════════════
   BACKGROUND SYNC (Service Worker)
══════════════════════════════════════════ */
async function tryBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('upload-sync');
    return true;
  } catch { return false; }
}

/* ══════════════════════════════════════════
   WEB SHARE
══════════════════════════════════════════ */
async function shareFile(item) {
  if (navigator.canShare && item.file) {
    try {
      if (navigator.canShare({ files: [item.file] })) {
        await navigator.share({ files: [item.file], title: item.name });
        return;
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[share]', e);
    }
  }
  // Fallback: download
  if (item.url) {
    const a = document.createElement('a');
    a.href     = item.url;
    a.download = item.name;
    a.click();
  } else if (item.file) {
    const url = URL.createObjectURL(item.file);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/* ══════════════════════════════════════════
   RENDER
══════════════════════════════════════════ */
function renderAll() {
  dom.fileList.innerHTML = '';
  state.queue.forEach(item => dom.fileList.appendChild(createItemEl(item)));
  dom.emptyState.classList.toggle('hidden', state.queue.length > 0);
  dom.fileListHeader.classList.toggle('hidden', state.queue.length === 0);
  dom.btnClear.classList.toggle('hidden', state.queue.length === 0);
  dom.btnResume.classList.toggle('hidden', !hasPendingUploads());
  applyFilter();
}

function createItemEl(item) {
  const li = document.createElement('li');
  li.className = `file-item ${item.status}`;
  li.id = `item-${item.id}`;

  // Thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'file-thumb';
  if (item.file) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    const burl = URL.createObjectURL(item.file);
    img.src = burl;
    img.onload  = () => URL.revokeObjectURL(burl);
    img.onerror = () => URL.revokeObjectURL(burl);
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = `<div class="file-thumb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l4-4 4 4 5-6 5 6"/></svg></div>`;
  }

  // Info
  const info = document.createElement('div');
  info.className = 'file-info';
  info.innerHTML = `
    <div class="file-name">${escHtml(item.name)}</div>
    <div class="file-meta">
      <span>${formatBytes(item.size)}</span>
      ${item.retries > 0 ? `<span>ניסיון ${item.retries}</span>` : ''}
    </div>
    <div class="file-progress"><div class="file-progress-fill" id="fp-${item.id}"></div></div>`;

  // Status badge
  const badge = document.createElement('span');
  badge.className = `file-status ${statusClass(item.status)}`;
  badge.id = `badge-${item.id}`;
  badge.textContent = statusLabel(item.status);

  li.appendChild(thumb);
  li.appendChild(info);
  li.appendChild(badge);

  // Retry button
  if (item.status === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-retry';
    retryBtn.textContent = 'נסה שוב';
    retryBtn.addEventListener('click', () => retrySingle(item));
    li.appendChild(retryBtn);
  }

  // Share button (for done items)
  if (item.status === 'done') {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-share';
    shareBtn.title = 'שתף / הורד';
    shareBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    shareBtn.addEventListener('click', () => shareFile(item));
    li.appendChild(shareBtn);
  }

  return li;
}

function updateItemDOM(item) {
  const li    = document.getElementById(`item-${item.id}`);
  const badge = document.getElementById(`badge-${item.id}`);
  const fp    = document.getElementById(`fp-${item.id}`);
  if (!li) { renderAll(); return; }

  li.className = `file-item ${item.status}`;
  if (badge) { badge.className = `file-status ${statusClass(item.status)}`; badge.textContent = statusLabel(item.status); }

  // Re-render retry/share buttons area
  const existingRetry = li.querySelector('.btn-retry');
  const existingShare = li.querySelector('.btn-share');
  if (existingRetry) existingRetry.remove();
  if (existingShare) existingShare.remove();

  if (item.status === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-retry';
    retryBtn.textContent = 'נסה שוב';
    retryBtn.addEventListener('click', () => retrySingle(item));
    li.appendChild(retryBtn);
  }
  if (item.status === 'done') {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-share';
    shareBtn.title = 'שתף / הורד';
    shareBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    shareBtn.addEventListener('click', () => shareFile(item));
    li.appendChild(shareBtn);
  }
}

function applyFilter() {
  dom.fileList.querySelectorAll('.file-item').forEach((el, idx) => {
    const item = state.queue[idx];
    if (!item) return;
    const show = state.filter === 'all' || item.status === state.filter;
    el.classList.toggle('hidden', !show);
  });
}

/* ══════════════════════════════════════════
   PROGRESS
══════════════════════════════════════════ */
function showProgress(show) {
  dom.overallProg.style.display = show ? 'block' : 'none';
  updateOverallProgress();
}

function updateOverallProgress() {
  const total  = state.queue.length;
  const done   = state.queue.filter(q => q.status === 'done').length;
  const failed = state.queue.filter(q => q.status === 'failed').length;
  const pct    = total ? Math.round(((done + failed) / total) * 100) : 0;

  dom.progressFill.style.width = `${pct}%`;
  dom.progressPct.textContent  = `${pct}%`;
  dom.progressLabel.textContent = done < total
    ? `מעלה... ${done}/${total}`
    : `הושלם ${done}/${total}`;
}

function finalizeProgress() {
  updateOverallProgress();
  const allDone = state.queue.every(q => q.status === 'done' || q.status === 'failed');
  if (allDone) {
    dom.progressLabel.textContent = '✓ גיבוי הסתיים';
    dom.btnResume.classList.add('hidden');
  }
  saveQueueToStorage();
  updateStats();
}

/* ══════════════════════════════════════════
   STATS
══════════════════════════════════════════ */
function updateStats() {
  const total   = state.queue.length;
  const done    = state.queue.filter(q => q.status === 'done').length;
  const failed  = state.queue.filter(q => q.status === 'failed').length;
  const bytes   = state.queue.reduce((s, q) => s + (q.size || 0), 0);

  dom.statTotal.textContent = total;
  dom.statDone.textContent  = done;
  dom.statFail.textContent  = failed;
  dom.statSize.textContent  = formatBytes(bytes);
}

/* ══════════════════════════════════════════
   RESUME / STORAGE
══════════════════════════════════════════ */
function saveQueueToStorage() {
  // Store only metadata (not File objects — those can't be serialized)
  const serializable = state.queue.map(({ id, name, size, status, retries, url }) =>
    ({ id, name, size, status, retries, url })
  );
  localStorage.setItem(CFG.QUEUE_KEY, JSON.stringify(serializable));
}

function loadSavedQueue() {
  const raw = localStorage.getItem(CFG.QUEUE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    // Restore without File objects — show as "pending" needing re-pick
    const resumable = saved.filter(s => s.status !== 'done');
    if (!resumable.length) {
      // Only done items — restore for display
      state.queue = saved.map(s => ({ ...s, file: null }));
      renderAll();
      updateStats();
      showProgress(state.queue.length > 0);
      updateOverallProgress();
      return;
    }

    // Has items not yet done
    if (saved.length > 0) {
      state.queue = saved.map(s => ({ ...s, file: null }));
      renderAll();
      updateStats();
      showProgress(true);
      updateOverallProgress();
      dom.btnResume.classList.remove('hidden');
    }
  } catch { /* ignore corrupt storage */ }
}

function retrySingle(item) {
  if (!item.file) {
    showToast('בחר שוב את הקובץ כדי להעלות');
    dom.fileInput.click();
    return;
  }
  item.status  = 'pending';
  item.retries = 0;
  updateItemDOM(item);
  startUploadQueue();
}

function hasPendingUploads() {
  return state.queue.some(q => q.status === 'pending' || q.status === 'failed');
}

function clearAll() {
  // Revoke any remaining blob URLs
  state.queue = [];
  localStorage.removeItem(CFG.QUEUE_KEY);
  dom.fileList.innerHTML = '';
  dom.emptyState.classList.remove('hidden');
  dom.fileListHeader.classList.add('hidden');
  dom.btnClear.classList.add('hidden');
  dom.btnResume.classList.add('hidden');
  showProgress(false);
  updateStats();
}

function refreshQueue() {
  renderAll();
  updateStats();
}

/* ══════════════════════════════════════════
   GALLERY MODAL
══════════════════════════════════════════ */
async function openGallery() {
  dom.modalGallery.classList.remove('hidden');
  dom.galleryGrid.innerHTML = '<p style="color:var(--text-mute);font-size:.85rem">טוען...</p>';

  try {
    const res  = await fetch(CFG.IMAGES_URL, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    });
    const data = await res.json();
    if (!data.images?.length) {
      dom.galleryGrid.innerHTML = '<p class="gallery-empty">אין עדיין תמונות מגובות</p>';
      return;
    }
    dom.galleryGrid.innerHTML = '';
    data.images.forEach(img => {
      const el  = document.createElement('img');
      el.src    = img.url;
      el.alt    = img.filename;
      el.loading = 'lazy';
      dom.galleryGrid.appendChild(el);
    });
  } catch {
    // Fallback: show locally queued done items
    const doneItems = state.queue.filter(q => q.status === 'done' && q.file);
    if (!doneItems.length) {
      dom.galleryGrid.innerHTML = '<p class="gallery-empty">לא ניתן לטעון תמונות</p>';
      return;
    }
    dom.galleryGrid.innerHTML = '';
    doneItems.forEach(item => {
      const el  = document.createElement('img');
      const url = URL.createObjectURL(item.file);
      el.src    = url;
      el.alt    = item.name;
      el.loading = 'lazy';
      el.onload = () => URL.revokeObjectURL(url);
      dom.galleryGrid.appendChild(el);
    });
  }
}

function closeGallery() {
  dom.modalGallery.classList.add('hidden');
}

/* ══════════════════════════════════════════
   ONLINE / OFFLINE
══════════════════════════════════════════ */
function checkOnlineStatus() { updateOnlineBanner(navigator.onLine); }
function updateOnlineBanner(online) {
  dom.offlineBanner.classList.toggle('hidden', online);
  if (!online) tryBackgroundSync();
}

/* ══════════════════════════════════════════
   AUTH HELPERS
══════════════════════════════════════════ */
function logout() {
  state.token = null;
  state.user  = null;
  state.queue = [];
  localStorage.removeItem(CFG.SESSION_KEY);
  dom.fileList.innerHTML = '';
  dom.emptyState.classList.remove('hidden');
  showAuth();
}

/* ══════════════════════════════════════════
   PWA INSTALL
══════════════════════════════════════════ */
async function installApp() {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  const { outcome } = await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  dom.installBanner.classList.add('hidden');
  if (outcome === 'accepted') showToast('האפליקציה הותקנה!');
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function showToast(msg, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--surface2)', color: 'var(--text)',
      padding: '10px 20px', borderRadius: '999px',
      fontSize: '.85rem', fontFamily: 'var(--font)',
      border: '1px solid var(--border2)',
      boxShadow: '0 4px 20px rgba(0,0,0,.5)',
      zIndex: 999, whiteSpace: 'nowrap',
      transition: 'opacity .3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.style.opacity = '0', duration);
}

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusClass(s) {
  return { pending: 'status-pending', uploading: 'status-uploading', done: 'status-done', failed: 'status-failed' }[s] || 'status-pending';
}

function statusLabel(s) {
  return { pending: 'ממתין', uploading: 'מעלה...', done: '✓ הצליח', failed: '✗ נכשל' }[s] || s;
}
