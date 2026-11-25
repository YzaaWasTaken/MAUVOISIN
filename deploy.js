(function(){
"use strict";

const THEME_KEY = 'mauvoisin_theme_v2';
const CONTACT_KEY = 'mauvoisin_contact_v2';
// Deploy version: no IndexedDB, loads from data.json

const APP = {
  db: null, items: [], aboutMedia: [], audio: [], branches: [], sheets: [],
  articleFolders: [], articles: [],
  view: 'projects', admin: false, theme: 'dark',
  activeBranch: null, activeFilters: [], aboutSearch: '',
  activeArticleFolder: null, activeArticle: null, articleEditMode: false,
  viewerIndex: 0, cursorX: 0, cursorY: 0,
  deskLayouts: {} // branchId -> {x,y,rot,z,scale,ratio}[] 初始摆放快照
};
const BIND_CAND = {};   // 装订候选（仅本次会话，不落库）
let ARCHIVE_VIEW_ID = null;
const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse)';
const mobileMQ = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
function isMobileLayout(){ return mobileMQ ? mobileMQ.matches : window.innerWidth <= 768; }

/* ============================================================
   INDEXEDDB
   ============================================================ */
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('media')) db.createObjectStore('media',{keyPath:'id'});
      if(!db.objectStoreNames.contains('aboutMedia')) db.createObjectStore('aboutMedia',{keyPath:'id'});
      if(!db.objectStoreNames.contains('audio')) db.createObjectStore('audio',{keyPath:'id'});
      if(!db.objectStoreNames.contains('branches')) db.createObjectStore('branches',{keyPath:'id'});
      if(!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      if(!db.objectStoreNames.contains('articleFolders')) db.createObjectStore('articleFolders',{keyPath:'id'});
      if(!db.objectStoreNames.contains('articles')) db.createObjectStore('articles',{keyPath:'id'});
    };
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
function idbGetAll(){return Promise.resolve([])}
function idbPut(){return Promise.resolve()}
function idbDel(){return Promise.resolve()}

/* ============================================================
   BLOB URL CACHE
   ============================================================ */
const blobIds = new WeakMap();
let nextBlobId = 1;
const blobUrlCache = new Map();
function blobUrl(blob){
  if(!blob) return '';
  if(typeof blob === 'string') return blob;
  if(!blobIds.has(blob)) blobIds.set(blob, nextBlobId++);
  const id = blobIds.get(blob);
  if(blobUrlCache.has(id)) return blobUrlCache.get(id);
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(id, url);
  return url;
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(){
  document.documentElement.setAttribute('data-theme', APP.theme);
  document.getElementById('toggleLabel').textContent = APP.theme.toUpperCase();
  document.getElementById('themeToggle').classList.toggle('is-on', APP.theme==='light');
}
function toggleTheme(){
  APP.theme = APP.theme==='dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, APP.theme);
  applyTheme();
}

/* ============================================================
   CURSOR SYSTEM
   ============================================================ */
function initCursor(){
  const cursorEl = document.getElementById('cursor');
  if(cursorEl) cursorEl.classList.add('is-ready');

  document.addEventListener('mousemove', e => {
    APP.cursorX = e.clientX;
    APP.cursorY = e.clientY;
    if(cursorEl){
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  });
  document.addEventListener('mousedown', () => { if(cursorEl) cursorEl.classList.add('is-down'); });
  document.addEventListener('mouseup', () => { if(cursorEl) cursorEl.classList.remove('is-down'); });

  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-cursor-title]');
    const info = document.getElementById('cursorInfo');
    if(t){
      cursorEl?.classList.add('is-hover');
      const k = t.dataset.cursorKey || '';
      const v = t.dataset.cursorVal || '';
      const title = t.dataset.cursorTitle || '';
      let html = '';
      if(k||v){
        html += '<div class="cursor-info__stack">';
        if(k) html += '<span class="cursor-info__cell"><span>'+esc(k)+'</span></span>';
        if(v) html += '<span class="cursor-info__cell"><span>'+esc(v)+'</span></span>';
        html += '</div>';
      }
      if(title) html += '<span class="cursor-info__cell cursor-info__cell--outline"><span>'+esc(title)+'</span></span>';
      info.innerHTML = html;
      info.classList.add('is-visible');
    } else {
      cursorEl?.classList.remove('is-hover');
      info.classList.remove('is-visible');
    }
  });
}

/* ============================================================
   GALLERY (Projects)
   ============================================================ */
const GALLERY_COL_KEY = 'mauvoisin_gallery_cols';
const SIZES = ['1x1','2x1','1x2','2x2','full'];
const SIZE_LABELS = {'1x1':'1×1','2x1':'2W','1x2':'2H','2x2':'2×2','full':'FULL','1':'1×1','2w':'2W'};

function getGalleryCols(){return parseInt(localStorage.getItem(GALLERY_COL_KEY)||'4')}

function setGalleryCols(n){
  localStorage.setItem(GALLERY_COL_KEY, String(n));
  document.querySelectorAll('.cols-btn').forEach(b => b.classList.toggle('is-active', parseInt(b.dataset.cols)===n));
  renderProjects();
}

function computeUnit(){
  const cols = getGalleryCols();
  document.documentElement.style.setProperty('--gallery-cols', String(cols));
}

function hashCode(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0}return Math.abs(h)}

function getItemSize(item){
  let s = item.size || '1x1';
  if(s === '1') s = '1x1';
  if(s === '2w') s = '2x1';
  return s;
}

function renderProjects(){
  const grid = document.getElementById('gallery');
  const items = APP.items;
  computeUnit();

  document.getElementById('galleryEmpty').style.display = items.length ? 'none' : 'block';
  grid.style.display = items.length ? 'grid' : 'none';

  const filtered = items.filter(it => {
    if(!APP.activeFilters.length) return true;
    return APP.activeFilters.every(f => (it.tags||[]).includes(f));
  }).sort((a,b) => {
    const oa = a.order !== undefined ? a.order : 999999;
    const ob = b.order !== undefined ? b.order : 999999;
    if(oa !== ob) return oa - ob;
    return (a.created||0) - (b.created||0);
  });

  grid.innerHTML = '';
  filtered.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'gallery__item';
    el.dataset.id = item.id;
    el.dataset.size = getItemSize(item);
    el.dataset.cursorTitle = item.title || '';
    el.dataset.cursorKey = (item.tags||[])[0] || '';
    el.dataset.cursorVal = (item.tags||[])[1] || '';
    el.addEventListener('click', (e) => {
      if(_reorderActive) return; // 排序模式下不打开 viewer
      openViewer(item.id);
    });
    el.draggable = _reorderActive;

    if(item.type === 'video'){
      const v = document.createElement('video');
      v.src = item.src || blobUrl(item.blob); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.draggable = false;
      el.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.src || blobUrl(item.blob); img.alt = item.title || '';
      img.draggable = false;
      el.appendChild(img);
    }

    const extraCount = (item.gallery && item.gallery.length) || 0;
    if(extraCount > 0){
      const badge = document.createElement('div');
      badge.className = 'gallery__badge';
      badge.textContent = '⧉ ' + (extraCount + 1);
      el.appendChild(badge);
    }

    const ht = document.createElement('div');
    ht.className = 'gallery__hover-title';
    ht.textContent = item.title || '';
    el.appendChild(ht);

    if(item.tags && item.tags.length){
      const tw = document.createElement('div');
      tw.className = 'gallery__hover-tags';
      item.tags.slice(0,3).forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'gallery__hover-tag';
        tag.textContent = t;
        tw.appendChild(tag);
      });
      el.appendChild(tw);
    }

    /* VIEW ONLY: edit / resize controls intentionally removed */

    grid.appendChild(el);
  });

  requestAnimationFrame(() => {
    grid.querySelectorAll('.gallery__item').forEach((el, i) => {
      setTimeout(() => el.classList.add('is-in'), i * 35);
    });
  });

  const empty = document.getElementById('galleryEmpty');
  if(!filtered.length && items.length){
    empty.style.display = 'block';
    empty.innerHTML = '<p>NO MATCHES</p><p style="font-size:10px;opacity:.6">Try removing a filter.</p>';
  } else {
    empty.style.display = items.length ? 'none' : 'block';
  }

  renderFilters();
  const fc = document.getElementById('footCount');
  if(fc) fc.textContent = items.length + ' WORK' + (items.length===1?'':'S');
}

/* ============================================================
   PROJECTS 拖拽排序 (Reorder Mode)
   ============================================================ */
let _reorderActive = false;
let _reorderDragId = null;

function toggleReorder(){
  _reorderActive = !_reorderActive;
  const btn = document.getElementById('orderToggleBtn');
  const grid = document.getElementById('gallery');
  if(btn) btn.classList.toggle('is-active', _reorderActive);
  if(grid) grid.classList.toggle('is-reordering', _reorderActive);

  // 立即更新已渲染 DOM 的 draggable 属性
  if(grid){
    grid.querySelectorAll('.gallery__item').forEach(el => {
      el.draggable = _reorderActive;
    });
  }

  if(_reorderActive){
    toast('拖拽图片调整顺序，完成后点击 ORDER 退出');
  } else {
    toast('排序已保存', true);
  }
}

function initReorderHandlers(){
  const grid = document.getElementById('gallery');
  if(!grid) return;

  grid.addEventListener('dragstart', (e) => {
    if(!_reorderActive) return;
    const item = e.target.closest('.gallery__item');
    if(!item) return;
    _reorderDragId = item.dataset.id;
    item.classList.add('is-dragging-reorder');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id);
  });

  grid.addEventListener('dragend', (e) => {
    if(!_reorderActive) return;
    const item = e.target.closest('.gallery__item');
    if(item) item.classList.remove('is-dragging-reorder');
    grid.querySelectorAll('.gallery__item').forEach(el => el.classList.remove('is-drag-over'));
    _reorderDragId = null;
  });

  grid.addEventListener('dragover', (e) => {
    if(!_reorderActive) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.gallery__item');
    if(item && item.dataset.id !== _reorderDragId){
      grid.querySelectorAll('.gallery__item').forEach(el => el.classList.remove('is-drag-over'));
      item.classList.add('is-drag-over');
    }
  });

  grid.addEventListener('dragleave', (e) => {
    if(!_reorderActive) return;
    const item = e.target.closest('.gallery__item');
    if(item) item.classList.remove('is-drag-over');
  });

  grid.addEventListener('drop', async (e) => {
    if(!_reorderActive || !_reorderDragId) return;
    e.preventDefault();
    const targetItem = e.target.closest('.gallery__item');
    if(!targetItem || targetItem.dataset.id === _reorderDragId) return;

    const fromIdx = APP.items.findIndex(it => it.id === _reorderDragId);
    const toIdx = APP.items.findIndex(it => it.id === targetItem.dataset.id);
    if(fromIdx < 0 || toIdx < 0) return;

    const [moved] = APP.items.splice(fromIdx, 1);
    APP.items.splice(toIdx, 0, moved);

    for(let i = 0; i < APP.items.length; i++){
      APP.items[i].order = i;
      await idbPut('media', APP.items[i]);
    }

    renderProjects();
    // 重新加上 reorder class（renderProjects 会清空 grid）
    document.getElementById('gallery').classList.add('is-reordering');
  });
}

function renderFilters(){
  const wrap = document.getElementById('tagFilters');
  const tags = {};
  APP.items.forEach(it => (it.tags||[]).forEach(t => tags[t] = (tags[t]||0)+1));
  const sorted = Object.keys(tags).sort();
  wrap.innerHTML = '';
  sorted.forEach(t => {
    const el = document.createElement('span');
    el.className = 'filter-tag' + (APP.activeFilters.includes(t) ? ' is-active' : '');
    el.textContent = t;
    el.dataset.tag = t;
    el.innerHTML += '<span class="filter-tag__count">'+tags[t]+'</span>';
    el.onclick = () => toggleFilter(t);
    el.dataset.cursorTitle = 'FILTER: '+t;
    wrap.appendChild(el);
  });
}

function cycleItemSize(id){
  const item = APP.items.find(it => it.id === id);
  if(!item) return;
  const cur = getItemSize(item);
  let idx = SIZES.indexOf(cur);
  if(idx < 0) idx = 0;
  const next = SIZES[(idx+1) % SIZES.length];
  item.size = next;
  idbPut('media', item);
  renderProjects();
  toast('SIZE: ' + (SIZE_LABELS[next]||next), true);
}

function toggleFilter(tag){
  const i = APP.activeFilters.indexOf(tag);
  if(i>=0) APP.activeFilters.splice(i,1);
  else APP.activeFilters.push(tag);
  renderProjects();
}
function clearFilter(){
  APP.activeFilters = [];
  renderProjects();
}

/* ============================================================
   VIEWER
   ============================================================ */
function openViewer(id){
  const idx = APP.items.findIndex(it => it.id === id);
  if(idx<0) return;
  APP.viewerIndex = idx;
  renderViewer();
  document.getElementById('viewer').classList.add('is-open');
  document.body.classList.add('modal-open');
}
function renderViewer(){
  const item = APP.items[APP.viewerIndex];
  if(!item) return;
  const inner = document.getElementById('viewerInner');

  let mediaHTML = '<div class="viewer__media-list">';
  if(item.type === 'video'){
    mediaHTML += `<video class="viewer__media" src="${item.src || blobUrl(item.blob)}" controls autoplay loop></video>`;
  } else {
    mediaHTML += `<img class="viewer__media" src="${item.src || blobUrl(item.blob)}" alt="${escAttr(item.title||'')}" draggable="false">`;
  }

  if(item.gallery && item.gallery.length){
    item.gallery.forEach(g => {
      const src = (typeof g === 'string') ? g : blobUrl(g);
      mediaHTML += `<img class="viewer__media" src="${src}" draggable="false">`;
    });
  }
  mediaHTML += '</div>';

  const tagsHTML = (item.tags||[]).map(t =>
    `<span class="viewer__tag">${esc(t)}</span>`
  ).join('');

  inner.innerHTML = `
    <div class="viewer__media-wrap">${mediaHTML}</div>
    <div class="viewer__info">
      <div class="viewer__title">${esc(item.title||'UNTITLED')}</div>
      ${item.note ? `<div class="viewer__note">${esc(item.note)}</div>` : ''}
      <div class="viewer__tags">${tagsHTML}</div>
      <!-- VIEW ONLY: no edit / tag / delete controls -->
      <div class="viewer__meta">${item.type.toUpperCase()} · ${item.id.slice(-6)}</div>
    </div>
  `;
}
function closeViewer(){
  document.getElementById('viewer').classList.remove('is-open');
  document.body.classList.remove('modal-open');
}
function viewerNext(){
  APP.viewerIndex = (APP.viewerIndex + 1) % APP.items.length;
  renderViewer();
}
function viewerPrev(){
  APP.viewerIndex = (APP.viewerIndex - 1 + APP.items.length) % APP.items.length;
  renderViewer();
}
function addTagToViewer(){
  const inp = document.getElementById('viewerTagInput');
  if(!inp) return;
  const t = inp.value.trim().toUpperCase();
  if(!t) return;
  const item = APP.items[APP.viewerIndex];
  if(!item.tags) item.tags = [];
  if(!item.tags.includes(t)){
    item.tags.push(t);
    idbPut('media', item);
    renderViewer();
    renderProjects();
  }
  inp.value = '';
}
function removeTagFromViewer(tag){
  const item = APP.items[APP.viewerIndex];
  if(!item.tags) return;
  const i = item.tags.indexOf(tag);
  if(i>=0){
    item.tags.splice(i,1);
    idbPut('media', item);
    renderViewer();
    renderProjects();
  }
}

/* ============================================================
   ITEM EDITOR
   ============================================================ */
const GRID_SIZE_OPTIONS = [
  { key: '1x1', label: '1×1 基础单格' },
  { key: '2x1', label: '2×1 双倍宽 (跨2列)' },
  { key: '1x2', label: '1×2 双倍高 (跨2行)' },
  { key: '2x2', label: '2×2 大正方 (跨2行2列)' },
  { key: 'full', label: 'FULL 整行撑满 (跨全列2行)' }
];

function openItemEditor(id){
  const item = APP.items.find(it => it.id === id);
  if(!item) return;
  window._curEditItem = item;
  if(!item.gallery) item.gallery = [];

  const curSize = getItemSize(item);
  const sizeOpts = GRID_SIZE_OPTIONS.map(s =>
    `<option value="${s.key}" ${curSize===s.key?'selected':''}>${s.label}</option>`
  ).join('');

  const body = `
    <div class="field">
      <label class="field__label">TITLE</label>
      <input class="field__input" id="edTitle" value="${escAttr(item.title||'')}" placeholder="Untitled">
    </div>
    <div class="field">
      <label class="field__label">GRID DISPLAY SIZE (排版展示规格)</label>
      <select class="field__input" id="edSize">${sizeOpts}</select>
      <div class="hint-text">更改规格后，其他图片会自动根据空隙紧凑回填补位。</div>
    </div>
    <div class="field">
      <label class="field__label">CAPTION / NOTE</label>
      <textarea class="field__input" id="edNote" placeholder="Write something...">${esc(item.note||'')}</textarea>
    </div>
    <div class="field">
      <label class="field__label">TAGS</label>
      <div class="tag-wrap" id="edTagWrap"></div>
    </div>
    <div class="field">
      <label class="field__label">SUB-IMAGES / GALLERY (图集子图片，点开后下滑查看)</label>
      <div class="ed-gallery-previews" id="edGalleryPreviews"></div>
      <input type="file" id="edGalleryInput" accept="image/*" multiple style="display:none" onchange="handleAddSubImages(event)">
      <button class="admin-btn" style="margin-top:8px" onclick="document.getElementById('edGalleryInput').click()">+ 添加更多子图片</button>
      <div class="hint-text">第一张为主封面，此处上传的图片会在详情页中垂直向下排版展示。</div>
    </div>
  `;
  const footer = `
    <button class="admin-btn admin-btn--danger" onclick="deleteItem('${item.id}')">DELETE</button>
    <button class="admin-btn" onclick="closeModal()">CANCEL</button>
    <button class="admin-btn admin-btn--primary" onclick="saveItem('${item.id}')">SAVE</button>
  `;
  openModal('EDIT ITEM', body, footer);
  renderTagPills(item);
  renderGalleryThumbnails(item);
}

function renderGalleryThumbnails(item){
  const wrap = document.getElementById('edGalleryPreviews');
  if(!wrap) return;
  wrap.innerHTML = '';
  if(!item.gallery) item.gallery = [];
  item.gallery.forEach((blob, idx) => {
    const d = document.createElement('div');
    d.className = 'ed-gallery-thumb';
    d.innerHTML = `<img src="${blobUrl(blob)}"><span class="ed-gallery-thumb-del" title="删除" onclick="removeSubImage(${idx})">×</span>`;
    wrap.appendChild(d);
  });
}

function handleAddSubImages(e){
  const files = [...e.target.files];
  if(!files.length) return;
  const item = window._curEditItem;
  if(!item) return;
  if(!item.gallery) item.gallery = [];
  files.forEach(f => item.gallery.push(f));
  renderGalleryThumbnails(item);
}

function removeSubImage(idx){
  const item = window._curEditItem;
  if(!item || !item.gallery) return;
  item.gallery.splice(idx, 1);
  renderGalleryThumbnails(item);
}

function renderTagPills(item){
  const wrap = document.getElementById('edTagWrap');
  wrap.innerHTML = '';
  (item.tags||[]).forEach((t, i) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = esc(t);
    const x = document.createElement('button');
    x.textContent = '×';
    x.onclick = () => { item.tags.splice(i,1); renderTagPills(item); };
    pill.appendChild(x);
    wrap.appendChild(pill);
  });
  const input = document.createElement('input');
  input.className = 'tag-input';
  input.placeholder = 'ADD TAG...';
  input.onkeydown = (e) => {
    if(e.key==='Enter'){
      e.preventDefault();
      const v = e.target.value.trim().toUpperCase();
      if(v && !(item.tags||[]).includes(v)){
        if(!item.tags) item.tags = [];
        item.tags.push(v);
        renderTagPills(item);
      }
      e.target.value = '';
    }
  };
  wrap.appendChild(input);
}

function saveItem(id){
  const item = APP.items.find(it => it.id === id);
  if(!item) return;
  item.title = document.getElementById('edTitle').value.trim();
  item.note = document.getElementById('edNote').value.trim();
  item.size = document.getElementById('edSize').value;
  idbPut('media', item);
  closeModal();
  renderProjects();
  if(document.getElementById('viewer').classList.contains('is-open')) renderViewer();
  updateStorageInfo();
  toast('SAVED', true);
}

function deleteItem(id){
  const i = APP.items.findIndex(it => it.id === id);
  if(i<0) return;
  idbDel('media', id);
  APP.items.splice(i, 1);
  closeModal();
  if(document.getElementById('viewer').classList.contains('is-open')) closeViewer();
  renderProjects();
  updateStorageInfo();
  toast('DELETED', true);
}

/* ============================================================
   ABOUT (Branch + Desktop Desk)
   ============================================================ */
function renderAbout(){
  // 核心容错：若未选激活分支，自动激活第一项
  if(!APP.activeBranch && APP.branches.length > 0){
    APP.activeBranch = APP.branches[0].id;
  }

  renderBranches();
  if(APP.activeBranch){
    renderSheets();
    renderAboutTags();
  } else {
    document.getElementById('aboutEmpty').style.display = 'flex';
    document.getElementById('aboutDesk').querySelectorAll('.sheet').forEach(s => s.remove());
    document.getElementById('aboutTags').innerHTML = '';
    document.getElementById('aboutFoot').textContent = 'SELECT A BRANCH';
  }
}

function renderBranches(){
  const list = document.getElementById('branchList');
  list.innerHTML = '';
  APP.branches.forEach(b => {
    const el = document.createElement('div');
    el.className = 'about-branch' + (APP.activeBranch===b.id ? ' is-active' : '');
    const count = APP.sheets.filter(s => s.branchId === b.id).length;
    el.dataset.cursorTitle = b.name;
    el.innerHTML = `<span class="about-branch__name">${esc(b.name)}</span><span class="about-branch__count">${count}</span>`;
    
    const rename = document.createElement('span');
    rename.className = 'about-branch__rename';
    rename.textContent = '✎';
    rename.title = 'RENAME';
    rename.onclick = (e) => { e.stopPropagation(); renameBranch(b.id); };
    el.appendChild(rename);

    const del = document.createElement('span');
    del.className = 'about-branch__del';
    del.textContent = '×';
    del.title = 'DELETE';
    del.onclick = (e) => { e.stopPropagation(); deleteBranch(b.id); };
    el.appendChild(del);

    el.onclick = () => selectBranch(b.id);
    list.appendChild(el);
  });
}

async function addBranch(){
  const name = await prompt2('Branch name:', 'NEW BRANCH');
  if(!name) return;
  const b = {id: 'br_'+Date.now().toString(36), name: name.toUpperCase(), created: Date.now()};
  await idbPut('branches', b);
  APP.branches.push(b);
  selectBranch(b.id);
  toast('BRANCH CREATED', true);
}

async function renameBranch(id){
  const b = APP.branches.find(x => x.id === id);
  if(!b) return;
  const name = await prompt2('New name:', 'RENAME BRANCH', b.name);
  if(!name) return;
  b.name = name.toUpperCase();
  await idbPut('branches', b);
  renderBranches();
  toast('RENAMED', true);
}

async function deleteBranch(id){
  if(!await confirm2('Delete this branch and all its sheets?')) return;
  await idbDel('branches', id);
  const sheets = APP.sheets.filter(s => s.branchId === id);
  for(const s of sheets) await idbDel('sheets', s.id);
  APP.branches = APP.branches.filter(b => b.id !== id);
  APP.sheets = APP.sheets.filter(s => s.branchId !== id);
  APP.activeBranch = APP.branches.length ? APP.branches[0].id : null;
  renderAbout();
  toast('BRANCH DELETED', true);
}

function selectBranch(id){
  APP.activeBranch = id;
  APP.aboutSearch = '';
  const inp = document.getElementById('aboutSearch');
  if(inp) inp.value = '';
  renderAbout();
}

function computeSheetDim(s, item){
  const scaleMap = { 'sm': 160, 'md': 220, 'lg': 300, 'xl': 400 };
  const w = scaleMap[s.scale || 'md'] || 220;
  
  if(s.isSticky){
    const r = s.ratio || '1:1';
    if(r === '3:4') return { w, h: Math.round(w * 1.33) };
    if(r === '4:3') return { w, h: Math.round(w * 0.75) };
    return { w, h: w };
  }

  const ratioType = s.ratio || 'auto';
  if(ratioType === '1:1') return { w, h: w };
  if(ratioType === '3:4') return { w, h: Math.round(w * (4/3)) };
  if(ratioType === '4:3') return { w, h: Math.round(w * (3/4)) };

  if(item && item.w && item.h && item.w > 0 && item.h > 0){
    const h = Math.round(w * (item.h / item.w));
    return { w, h: Math.max(80, h) };
  }
  return { w, h: Math.round(w * 1.25) };
}

function renderSheets(){
  const desk = document.getElementById('aboutDesk');
  const empty = document.getElementById('aboutEmpty');
  const toolbar = document.getElementById('aboutDeskToolbar');
  desk.querySelectorAll('.sheet').forEach(s => s.remove());

  let sheets = APP.sheets.filter(s => s.branchId === APP.activeBranch);

  if(!sheets.length){
    if(toolbar) toolbar.style.display = APP.activeBranch ? 'flex' : 'none';
    empty.style.display = 'flex';
    empty.innerHTML = `
      <p>当前分支暂无内容</p>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="gallery__empty-btn" onclick="addSheet()">+ 添加 SHEET</button>
        <button class="gallery__empty-btn" onclick="openCreateSticky()">✎ 新增便利贴</button>
      </div>
    `;
    document.getElementById('aboutFoot').textContent = '0 SHEETS';
    return;
  }

  empty.style.display = 'none';
  if(toolbar) toolbar.style.display = 'flex';

  const searchTags = APP.aboutSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  
  // 按照自然层级排序，让后摸过的压在先摸过的上面
  sheets.sort((a,b) => (a.z||0) - (b.z||0));

  sheets.forEach((s, i) => {
    const item = s.isArchive
      ? (APP.aboutMedia.find(it => it.id === (s.pages || [])[s.pageIndex || 0]) || null)
      : (s.isSticky ? null : APP.aboutMedia.find(it => it.id === s.itemId));
    if(s.isArchive ? !item : (!s.isSticky && !item)) return;

    const matches = !searchTags.length || searchTags.every(st =>
      (s.tags||[]).some(t => t.toLowerCase().includes(st))
    );

    const dim = computeSheetDim(s, item);
    const rot = s.rot !== undefined ? s.rot : ((hashCode(s.id) % 14) - 7);
    const x = s.x !== undefined ? s.x : (60 + (i * 45) % 360);
    const y = s.y !== undefined ? s.y : (60 + (i * 35) % 240);
    const mobile = isMobileLayout();

    const el = document.createElement('div');
    el.className = 'sheet' + (s.isSticky ? ' is-sticky' : '') + (matches ? '' : ' is-filtered-out');
    el.dataset.id = s.id;
    el.dataset.cursorTitle = s.isSticky ? (s.title || 'STICKY NOTE') : (item.title || '');
    el.style.zIndex = s.z || (i + 1);
    if(mobile){
      // 手机/触屏：卡片流布局，保留原纸张比例但不写死桌面坐标
      el.classList.add('sheet--mobile');
      el.style.setProperty('--sheet-ratio', dim.w + ' / ' + dim.h);
    } else {
      el.style.width = dim.w + 'px';
      el.style.height = dim.h + 'px';
      el.dataset.x = x;
      el.dataset.y = y;
      el.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg)`;
    }

    const inner = document.createElement('div');
    inner.className = 'sheet__inner' + (s.isSticky ? '' : ' is-media');

    if(s.isSticky){
      const colorCls = s.color ? `sticky--${s.color}` : 'sticky--yellow';
      inner.innerHTML = `
        <div class="sticky-note ${colorCls}" style="font-family:${s.fontFamily || 'var(--mono)'};font-size:${s.fontSize || '12px'}">
          ${s.title ? `<div class="sticky-note__title">${esc(s.title)}</div>` : ''}
          <div class="sticky-note__body">${esc(s.content || '')}</div>
          ${s.scribble ? `<img src="${s.scribble}" style="width:100%;height:auto;margin-top:6px;border:1px solid rgba(0,0,0,.1);pointer-events:none" draggable="false">` : ''}
          <div class="sticky-note__meta">STICKY · ${formatDate(s.created)}</div>
        </div>
      `;
    } else {
      const img = document.createElement('img');
      img.src = item.src || blobUrl(item.blob);
      img.alt = item.title || '';
      img.draggable = false;
      img.style.objectFit = (s.ratio && s.ratio !== 'auto') ? 'cover' : 'contain';
      inner.appendChild(img);
      if(s.isArchive){
        const badge = document.createElement('div');
        badge.className = 'sheet__pages';
        badge.textContent = (s.pages || []).length + ' P';
        inner.appendChild(badge);
      }
    }
    el.appendChild(inner);

    // 桌面化快捷控制角标（放大聚焦 / 编辑属性 / 移出桌面）
    const bar = document.createElement('div');
    bar.className = 'sheet__quick-bar';
    bar.innerHTML = `
      <button class="sheet-btn" title="属性与规格设定" onclick="event.stopPropagation();${s.isSticky ? `openStickyEditor('${s.id}')` : `openSheetEditor('${s.id}')`}">✎</button>
      <button class="sheet-btn sheet-btn--del" title="彻底移出桌面" onclick="event.stopPropagation();deleteSheet('${s.id}')">×</button>
    `;
    el.appendChild(bar);

    /* 部署版只读：装订按钮已移除，装订关系完全由编辑版保存后同步显示 */
    if(mobile){
      // 卡片流不需要物理拖拽；轻点直接打开预览
      if(matches) el.addEventListener('click', (e) => {
        if(e.target.closest('.sheet__quick-bar')) return;
        handleSheetClick(el, s);
      });
    } else if(matches) {
      makeDraggable(el, s);
    }
    desk.appendChild(el);
  });

  document.getElementById('aboutFoot').textContent = sheets.length + ' SHEET' + (sheets.length===1?'':'S');

  // 同步 deskMaxZ 为当前所有 sheets 的最大 z 值
  const maxZ = Math.max(100, ...sheets.map(s => s.z || 0));
  APP.deskMaxZ = maxZ;
}

// 聚焦拉近（在桌面上方平滑浮现并放大居中，不跳出桌面）
function focusSheet(sheetId){
  const el = document.querySelector(`.sheet[data-id="${sheetId}"]`);
  const s = APP.sheets.find(x => x.id === sheetId);
  if(!el || !s) return;

  // 先解除之前可能已聚焦的纸张
  unfocusAllSheets();

  // 其他纸张退后微暗
  document.querySelectorAll('.sheet').forEach(dom => {
    if(dom !== el) dom.classList.add('is-dimmed');
  });

  const desk = document.getElementById('aboutDesk');
  const dw = desk.clientWidth, dh = desk.clientHeight;
  let targetW, targetH;
  if(s.isSticky){
    // 便利贴：沿用摆放时的宽高比，只等比放大 + 摆正，不拉伸变形
    const dim = computeSheetDim(s, null);
    const maxSide = Math.min(560, dw - 80, dh - 80);
    const k = maxSide / Math.max(dim.w, dim.h);
    targetW = Math.round(dim.w * k);
    targetH = Math.round(dim.h * k);
  } else {
    targetW = Math.min(560, dw - 80);
    targetH = Math.min(700, dh - 80);
  }

  const targetX = (dw - targetW) / 2;
  const targetY = (dh - targetH) / 2;

  el.classList.add('is-focused');
  el.style.width = targetW + 'px';
  el.style.height = targetH + 'px';
  // 摆正呈现
  el.style.transform = `translate(${targetX}px, ${targetY}px) rotate(0deg)`;
}

// 解除所有聚焦状态，平滑归位至桌面原坐标与角度
function unfocusAllSheets(){
  document.querySelectorAll('.sheet').forEach(dom => {
    dom.classList.remove('is-dimmed');
    if(dom.classList.contains('is-focused')){
      dom.classList.remove('is-focused');
      const s = APP.sheets.find(x => x.id === dom.dataset.id);
      if(s){
        const item = s.isSticky ? null : APP.aboutMedia.find(it => it.id === s.itemId);
        const dim = computeSheetDim(s, item);
        dom.style.width = dim.w + 'px';
        dom.style.height = dim.h + 'px';
        dom.style.transform = `translate(${s.x || 0}px, ${s.y || 0}px) rotate(${s.rot || 0}deg)`;
        dom.style.zIndex = s.z || 10;
      }
    }
  });
}

/* ============================================================
   BUMPTOP 物理散页抓取与绝对层叠提升 (Z-Index Escalation)
   ============================================================ */
const DESK_PHYSICS = {
  active: false,
  el: null,
  sheet: null,
  startX: 0,
  startY: 0,
  origX: 0,
  origY: 0,
  hasMoved: false,
  candidate: null,
  targetEl: null,
  group: null,
  groupLocked: false,
  root: null,
  origRootX: 0,
  origRootY: 0
};

// 全局桌面最高层级计数器
APP.deskMaxZ = 100;

/* ---------- 装订（同频组合）---------- */
function childrenOfBind(id){
  return APP.sheets.filter(s => (s.boundTo || s.attachedTo) === id);
}
function bindDescendants(id){
  const out = [], stack = childrenOfBind(id), seen = {};
  while(stack.length){
    const s = stack.shift();
    if(seen[s.id]) continue;
    seen[s.id] = 1;
    out.push(s);
    childrenOfBind(s.id).forEach(c => stack.push(c));
  }
  return out;
}
function bindOffset(s){
  return {
    x: s.bx !== undefined ? s.bx : (s.ax || 0),
    y: s.by !== undefined ? s.by : (s.ay || 0)
  };
}
// 与底层文件同频移动：同一帧内按实时父坐标逐层推算，整棵装订树一起到位（无延迟、无先后）
function moveBoundDescendants(sheet, baseX, baseY, movingSet){
  bindDescendants(sheet.id).forEach(child => {
    const off = bindOffset(child);
    const parent = APP.sheets.find(x => x.id === (child.boundTo || child.attachedTo));
    const isParentMoving = movingSet && parent && movingSet.has(parent.id);
    const px = isParentMoving ? (parent.__liveX !== undefined ? parent.__liveX : baseX) : (parent ? (parent.x || 0) : baseX);
    const py = isParentMoving ? (parent.__liveY !== undefined ? parent.__liveY : baseY) : (parent ? (parent.y || 0) : baseY);
    child.x = px + off.x;
    child.y = py + off.y;
    child.__liveX = child.x;
    child.__liveY = child.y;
    const ce = document.querySelector(`.sheet[data-id="${child.id}"]`);
    if(ce){
      ce.dataset.x = child.x;
      ce.dataset.y = child.y;
      ce.style.transform = `translate(${child.x}px, ${child.y}px) rotate(${child.rot || 0}deg)`;
    }
  });
  bindDescendants(sheet.id).forEach(c => { delete c.__liveX; delete c.__liveY; });
}
// 找到装订树最顶层的根纸（抓任意成员都以它为整组基准）
function findBindRoot(sheet){
  let root = sheet, guard = 0;
  while(root && (root.boundTo || root.attachedTo) && guard++ < 50){
    const p = APP.sheets.find(x => x.id === (root.boundTo || root.attachedTo));
    if(!p) break;
    root = p;
  }
  return root;
}
// 抓住一张纸时，把它所在的整棵装订组合一起标记为同帧移动（含它自身的祖先链）
function markGroupDragging(sheet, on){
  const group = new Set();
  const root = findBindRoot(sheet);
  if(root){
    group.add(root.id);
    bindDescendants(root.id).forEach(d => group.add(d.id));
  }
  group.forEach(id => {
    const el = document.querySelector(`.sheet[data-id="${id}"]`);
    if(el) el.classList.toggle('is-group-dragging', on);
  });
  return group;
}
// 装订组合的拿起/放下微动画：组内每一张表现都与被拖对象一致
function setGroupLift(group, on){
  if(!group) return;
  group.forEach(id => {
    const el = document.querySelector(`.sheet[data-id="${id}"]`);
    if(!el) return;
    el.classList.remove('is-dropped');
    if(on){ el.classList.add('is-lifted'); }
    else{
      el.classList.remove('is-lifted');
      void el.offsetWidth;
      el.classList.add('is-dropped');
      setTimeout(() => el.classList.remove('is-dropped'), 320);
    }
  });
}
function findBindCandidate(el, sheet){
  // 用几何重叠判定，避免指针超出桌面可视区或被光标层遮挡时漏判
  const dr = el.getBoundingClientRect();
  const descendants = bindDescendants(sheet.id).map(d => d.id);
  const hits = [];
  APP.sheets.forEach(t => {
    if(t.id === sheet.id || descendants.indexOf(t.id) >= 0) return;
    const te = document.querySelector(`.sheet[data-id="${t.id}"]`);
    if(!te || te.classList.contains('is-filtered-out')) return;
    const tr = te.getBoundingClientRect();
    const ox = Math.max(0, Math.min(dr.right, tr.right) - Math.max(dr.left, tr.left));
    const oy = Math.max(0, Math.min(dr.bottom, tr.bottom) - Math.max(dr.top, tr.top));
    const area = ox * oy;
    const threshold = Math.min(dr.width * dr.height, tr.width * tr.height) * 0.12;
    if(area > threshold) hits.push({ sheet: t, el: te, area, z: t.z || 0 });
  });
  if(!hits.length) return null;
  hits.sort((a, b) => b.z - a.z || b.area - a.area);
  return { sheet: hits[0].sheet, el: hits[0].el };
}

function initDragHandlers(){
  // 监听桌面空白处点击：取消所有聚焦纸张，回归自然桌面全貌
  const desk = document.getElementById('aboutDesk');
  if(desk){
    desk.addEventListener('click', (e) => {
      if(e.target === desk || e.target.id === 'aboutEmpty'){
        unfocusAllSheets();
      }
    });
  }

  document.addEventListener('mousemove', e => {
    if(!DESK_PHYSICS.active || !DESK_PHYSICS.el) return;
    const dx = e.clientX - DESK_PHYSICS.startX;
    const dy = e.clientY - DESK_PHYSICS.startY;

    if(Math.hypot(dx, dy) > 4){
      DESK_PHYSICS.hasMoved = true;
    }

    if(Math.hypot(dx, dy) > 4 && !DESK_PHYSICS.groupLocked){
      DESK_PHYSICS.groupLocked = true;
      markGroupDragging(DESK_PHYSICS.root, true);
      setGroupLift(DESK_PHYSICS.group, true);
    }

    // 抓任意成员都以根纸的新坐标为唯一基准，整组按同一位移移动
    const root = DESK_PHYSICS.root || DESK_PHYSICS.sheet;
    const curRootX = DESK_PHYSICS.origRootX + dx;
    const curRootY = DESK_PHYSICS.origRootY + dy;
    root.x = curRootX;
    root.y = curRootY;
    root.__liveX = curRootX;
    root.__liveY = curRootY;
    const rootEl = document.querySelector(`.sheet[data-id="${root.id}"]`);
    if(rootEl){
      rootEl.dataset.x = curRootX;
      rootEl.dataset.y = curRootY;
      rootEl.style.transform = `translate(${curRootX}px, ${curRootY}px) rotate(${root.rot || 0}deg)`;
    }

    // 子级（含被抓住的那张）位置由递归统一写入，同帧到位，相对偏移不变
    moveBoundDescendants(root, curRootX, curRootY, DESK_PHYSICS.group);
  });

  document.addEventListener('mouseup', async () => {
    if(!DESK_PHYSICS.active) return;
    DESK_PHYSICS.active = false;

    if(DESK_PHYSICS.el){
      const el = DESK_PHYSICS.el;
      const sheet = DESK_PHYSICS.sheet;
      el.classList.remove('is-dragging');
      if(DESK_PHYSICS.targetEl) DESK_PHYSICS.targetEl.classList.remove('is-bind-target');

      if(DESK_PHYSICS.hasMoved){
        const root = DESK_PHYSICS.root || sheet;
        const rootEl = document.querySelector(`.sheet[data-id="${root.id}"]`);
        root.x = parseFloat((rootEl && rootEl.dataset.x) || root.x);
        root.y = parseFloat((rootEl && rootEl.dataset.y) || root.y);
        // 子级坐标已在 mousemove 中按根实时坐标写入，装订相对偏移保持不变
      }
      // 始终保存 z 值（mousedown 时 bringSheetToFront 已更新 sheet.z）
      sheet.z = parseInt(el.style.zIndex || 1);
      delete sheet.__liveX; delete sheet.__liveY;
      const persist = new Set([sheet.id]);
      if(DESK_PHYSICS.group) DESK_PHYSICS.group.forEach(id => persist.add(id));
      for(const id of persist){
        const rec = APP.sheets.find(x => x.id === id);
        if(rec){ delete rec.__liveX; delete rec.__liveY; await idbPut('sheets', rec); }
      }

      if(!DESK_PHYSICS.hasMoved){
        handleSheetClick(el, sheet);
      }
    }

    if(DESK_PHYSICS.group){
      if(DESK_PHYSICS.groupLocked) setGroupLift(DESK_PHYSICS.group, false);
      markGroupDragging(DESK_PHYSICS.root || DESK_PHYSICS.sheet, false);
    }
    DESK_PHYSICS.el = null;
    DESK_PHYSICS.sheet = null;
    DESK_PHYSICS.root = null;
    DESK_PHYSICS.candidate = null;
    DESK_PHYSICS.targetEl = null;
    DESK_PHYSICS.group = null;
    DESK_PHYSICS.groupLocked = false;
    DESK_PHYSICS.hasMoved = false;
  });
}

// 触摸/抓起纸张：瞬间将其提升至绝对物理最顶层
function bringSheetToFront(el, sheet){
  APP.deskMaxZ = Math.max(APP.deskMaxZ + 1, (sheet.z || 0) + 1);
  el.style.zIndex = APP.deskMaxZ;
  sheet.z = APP.deskMaxZ;
  // 装订的文件始终压在底层文件之上（含多层嵌套）
  bindDescendants(sheet.id).forEach(s => {
    s.z = ++APP.deskMaxZ;
    const se = document.querySelector(`.sheet[data-id="${s.id}"]`);
    if(se) se.style.zIndex = s.z;
  });
}

function makeDraggable(el, sheet){
  el.addEventListener('mousedown', (e) => {
    // 聚焦状态下或者点击控制按钮不进行自由拖拽
    if(el.classList.contains('is-focused')) return;
    if(e.target.closest('.sheet__quick-bar')) return;
    if(e.button !== 0) return;

    // 1. 抓住装订组任意成员时，都以根纸为基准抬起并置顶整棵树
    const root = findBindRoot(sheet);
    const rootEl = document.querySelector(`.sheet[data-id="${root.id}"]`);
    bringSheetToFront(rootEl || el, root);

    // 2. 初始化物理抓起手势
    DESK_PHYSICS.active = true;
    DESK_PHYSICS.el = el;
    DESK_PHYSICS.sheet = sheet;
    DESK_PHYSICS.root = root;
    DESK_PHYSICS.startX = e.clientX;
    DESK_PHYSICS.startY = e.clientY;
    DESK_PHYSICS.origX = parseFloat(el.dataset.x || 0);
    DESK_PHYSICS.origY = parseFloat(el.dataset.y || 0);
    DESK_PHYSICS.origRootX = root.x || 0;
    DESK_PHYSICS.origRootY = root.y || 0;
    DESK_PHYSICS.hasMoved = false;
    DESK_PHYSICS.group = markGroupDragging(root, false);
    DESK_PHYSICS.groupLocked = false;

    el.classList.add('is-dragging');
  });

  // 单击打开图片（在 mouseup 中判定，如果没有拖动就触发）
  // 见 initDragHandlers 中的 mouseup 处理逻辑
}

// 单击打开判定：在全局 mouseup 中处理
// 如果没有移动（hasMoved=false），则视为单击 → 聚焦打开
function handleSheetClick(el, sheet){
  if(!el || !sheet) return;
  if(sheet.isArchive){ openArchiveViewer(sheet.id); return; }
  if(isMobileLayout()){
    if(sheet.isSticky){
      openModal(sheet.title || 'STICKY NOTE',
        `<div style="line-height:1.7;white-space:pre-wrap">${esc(sheet.content || '')}</div>`,
        `<button class="gallery__empty-btn" onclick="closeModal()">CLOSE</button>`);
    } else {
      openArchiveViewer(sheet.id);
    }
    return;
  }
  // 便利贴同样进入聚焦：按自身比例放大摆正（见 focusSheet），不拉伸变形
  if(el.classList.contains('is-focused')){
    unfocusAllSheets();
  } else {
    focusSheet(sheet.id);
  }
}

/* ============================================================
   装订 / 档案多页上传与查看
   ============================================================ */
async function toggleBind(id){
  const s = APP.sheets.find(x => x.id === id);
  if(!s) return;
  if(s.boundTo || s.attachedTo){
    const parent = APP.sheets.find(x => x.id === (s.boundTo || s.attachedTo));
    const off = bindOffset(s);
    if(parent){ s.x = (parent.x || 0) + off.x; s.y = (parent.y || 0) + off.y; }
    delete s.boundTo; delete s.attachedTo; delete s.bx; delete s.by; delete s.ax; delete s.ay;
    delete BIND_CAND[id];
    await idbPut('sheets', s);
    renderSheets();
    toast('已解除装订', true);
    return;
  }
  const targetId = BIND_CAND[id];
  const target = targetId && APP.sheets.find(x => x.id === targetId);
  if(!target){ toast('先把这张纸拖到另一张图片或便签上方'); return; }
  s.boundTo = target.id;
  s.bx = (s.x || 0) - (target.x || 0);
  s.by = (s.y || 0) - (target.y || 0);
  s.z = Math.max(target.z || 0, APP.deskMaxZ) + 1;
  APP.deskMaxZ = s.z;
  delete BIND_CAND[id];
  await idbPut('sheets', s);
  bindDescendants(s.id).forEach(c => { c.z = ++APP.deskMaxZ; idbPut('sheets', c); });
  renderSheets();
  toast('装订完成 · 整组同帧移动', true);
}

function openArchiveUpload(){
  if(!APP.activeBranch){
    if(APP.branches.length > 0) APP.activeBranch = APP.branches[0].id;
    else { toast('请先新建一个分支'); return; }
  }
  const body = `
    <div class="field">
      <label class="field__label">选择档案图片（可多选，按顺序叠放；支持角色档案页导出的 PNG）</label>
      <input type="file" id="archiveFiles" accept="image/*" multiple class="field__input">
    </div>
    <div class="field">
      <label class="field__label">桌面尺寸</label>
      <select class="field__input" id="archiveScale">
        <option value="sm">小号 (160px)</option>
        <option value="md" selected>中号 (220px)</option>
        <option value="lg">大号 (300px)</option>
        <option value="xl">大号 (400px)</option>
      </select>
    </div>
    <p style="font-size:10px;opacity:.65;line-height:1.6">多张会组合为一个档案叠，桌面只显示最上面一张；一起拖动，点开可左右翻页。</p>
  `;
  openModal('UPLOAD ARCHIVE', body, `
    <button class="admin-btn" onclick="closeModal()">CANCEL</button>
    <button class="admin-btn admin-btn--primary" onclick="confirmArchiveUpload()">加入桌面</button>
  `);
}

async function confirmArchiveUpload(){
  const input = document.getElementById('archiveFiles');
  const files = input ? Array.from(input.files).filter(f => f.type.startsWith('image/')) : [];
  if(!files.length){ toast('请先选择档案图片'); return; }
  const desk = document.getElementById('aboutDesk');
  const dw = desk.clientWidth - 300, dh = desk.clientHeight - 360;
  const ids = [];
  let w0 = 0, h0 = 0;
  for(const file of files){
    const dim = await new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 1240, h: 1754 });
      img.src = URL.createObjectURL(file);
    });
    const id = 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const media = {
      id, type: 'image', title: file.name.replace(/\.[^.]+$/, '').toUpperCase(),
      tags: [], note: '', blob: file, size: '1x1', w: dim.w, h: dim.h, created: Date.now()
    };
    await idbPut('aboutMedia', media);
    APP.aboutMedia.push(media);
    ids.push(id);
    if(!w0){ w0 = dim.w; h0 = dim.h; }
  }
  const sheet = {
    id: 'sh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    branchId: APP.activeBranch, isArchive: true, pages: ids, pageIndex: 0,
    scale: document.getElementById('archiveScale').value, ratio: 'auto',
    tags: [], w: w0, h: h0,
    x: 40 + Math.random() * Math.max(20, dw),
    y: 40 + Math.random() * Math.max(20, dh),
    rot: (Math.random() * 10 - 5), z: Date.now(), created: Date.now()
  };
  await idbPut('sheets', sheet);
  APP.sheets.push(sheet);
  closeModal();
  renderBranches();
  renderSheets();
  toast('档案已加入桌面（' + ids.length + ' 页）', true);
}

function ensureArchiveViewer(){
  if(document.getElementById('archiveViewer')) return;
  const ov = document.createElement('div');
  ov.id = 'archiveViewer';
  ov.className = 'archive-viewer';
  ov.innerHTML = `
    <div class="archive-viewer__bar">
      <button id="archiveViewerPrev" title="上一页">‹</button>
      <span id="archiveViewerCount">1 / 1</span>
      <button id="archiveViewerNext" title="下一页">›</button>
      <button id="archiveViewerClose" title="关闭">×</button>
    </div>
    <img id="archiveViewerImg" alt="ARCHIVE PAGE">
    <div class="archive-viewer__hint">← → 翻页 · ESC 关闭</div>
  `;
  document.body.appendChild(ov);
  document.getElementById('archiveViewerPrev').onclick = () => archiveViewerNav(-1);
  document.getElementById('archiveViewerNext').onclick = () => archiveViewerNav(1);
  document.getElementById('archiveViewerClose').onclick = closeArchiveViewer;
  ov.addEventListener('click', e => { if(e.target === ov) closeArchiveViewer(); });
  document.addEventListener('keydown', e => {
    if(!ov.classList.contains('is-open')) return;
    if(e.key === 'Escape') closeArchiveViewer();
    else if(e.key === 'ArrowLeft') archiveViewerNav(-1);
    else if(e.key === 'ArrowRight') archiveViewerNav(1);
  });
}
// 档案叠有多页；普通 SHEET 视为单页图片，手机端共用同一个全屏预览层
function sheetPages(s){
  if(!s) return [];
  if(s.isArchive) return s.pages || [];
  return s.itemId ? [s.itemId] : [];
}
function openArchiveViewer(sheetId){
  const s = APP.sheets.find(x => x.id === sheetId);
  if(!s || !sheetPages(s).length) return;
  ensureArchiveViewer();
  ARCHIVE_VIEW_ID = sheetId;
  document.getElementById('archiveViewer').classList.add('is-open');
  renderArchiveViewer();
}
function renderArchiveViewer(){
  const s = APP.sheets.find(x => x.id === ARCHIVE_VIEW_ID);
  if(!s){ closeArchiveViewer(); return; }
  const pages = sheetPages(s);
  const idx = s.pageIndex || 0;
  const item = APP.aboutMedia.find(it => it.id === pages[idx]);
  const img = document.getElementById('archiveViewerImg');
  img.src = item ? (item.src || blobUrl(item.blob)) : '';
  document.getElementById('archiveViewerCount').textContent = (idx + 1) + ' / ' + pages.length;
  document.getElementById('archiveViewerPrev').disabled = idx <= 0;
  document.getElementById('archiveViewerNext').disabled = idx >= pages.length - 1;
}
function archiveViewerNav(dir){
  const s = APP.sheets.find(x => x.id === ARCHIVE_VIEW_ID);
  if(!s) return;
  const pages = sheetPages(s);
  if(pages.length < 2) return;
  s.pageIndex = Math.max(0, Math.min(pages.length - 1, (s.pageIndex || 0) + dir));
  idbPut('sheets', s);
  renderArchiveViewer();
  renderSheets();
}
function closeArchiveViewer(){
  const ov = document.getElementById('archiveViewer');
  if(ov) ov.classList.remove('is-open');
  ARCHIVE_VIEW_ID = null;
}

/* ============================================================
   添加 SHEET (彻底修复选择/上传逻辑)
   ============================================================ */
async function addSheet(){
  if(!APP.activeBranch){
    if(APP.branches.length > 0) APP.activeBranch = APP.branches[0].id;
    else { toast('请先新建一个分支'); return; }
  }

  window._sheetSelectedItemId = null;

  let pickerHTML = '';
  if(APP.aboutMedia.length){
    pickerHTML = `
      <div class="field">
        <label class="field__label">从 About 图片库选择已有图片</label>
        <div id="sheetPicker" style="max-height:180px;overflow-y:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;border:1px solid var(--line);padding:6px;background:var(--bg)">
          ${APP.aboutMedia.map(it => `
            <div data-id="${it.id}" onclick="selectItemForSheet('${it.id}')" style="cursor:none;aspect-ratio:1;overflow:hidden;border:2px solid transparent;background:var(--surface)">
              <img src="${blobUrl(it.blob)}" style="width:100%;height:100%;object-fit:cover" draggable="false">
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const body = `
    <div class="field">
      <label class="field__label">直接上传新图片至此分支</label>
      <div class="upload-dropzone" id="sheetDropZone" onclick="document.getElementById('sheetFileInput').click()">
        <p style="font-size:12px;margin-bottom:4px">+ 点击或拖拽上传新图片</p>
        <p style="font-size:9px;opacity:.6">上传后会自动生成卡片置于桌面上</p>
      </div>
      <input type="file" id="sheetFileInput" accept="image/*,video/*" style="display:none" onchange="handleSheetDirectUpload(event)">
      <div id="sheetUploadTip" style="display:none;margin-top:8px;font-size:10px;color:var(--ok)">✓ 新图片已就绪</div>
    </div>
    ${pickerHTML}
    <div class="field">
      <label class="field__label">尺寸设定</label>
      <select class="field__input" id="sheetScaleInput">
        <option value="sm">小号 (160px)</option>
        <option value="md" selected>中号 (220px)</option>
        <option value="lg">大号 (300px)</option>
      </select>
    </div>
  `;

  openModal('ADD SHEET', body, `
    <button class="admin-btn" onclick="closeModal()">CANCEL</button>
    <button class="admin-btn admin-btn--primary" onclick="confirmAddSheet()">ADD TO DESK</button>
  `);
}

function selectItemForSheet(id){
  window._sheetSelectedItemId = id;
  const picker = document.getElementById('sheetPicker');
  if(picker){
    picker.querySelectorAll('[data-id]').forEach(d => d.style.borderColor = 'transparent');
    const selected = picker.querySelector(`[data-id="${id}"]`);
    if(selected) selected.style.borderColor = 'var(--fg)';
  }
}

async function handleSheetDirectUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  const isVideo = file.type.startsWith('video/');
  const id = 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  
  let w = 800, h = 600;
  if(!isVideo){
    const d = await new Promise(res => {
      const img = new Image();
      img.onload = () => res({w:img.naturalWidth, h:img.naturalHeight});
      img.onerror = () => res({w:800, h:600});
      img.src = URL.createObjectURL(file);
    });
    w = d.w; h = d.h;
  }

  const item = {
    id, type: isVideo ? 'video' : 'image',
    title: file.name.replace(/\.[^.]+$/, '').toUpperCase(),
    tags: [], note: '', blob: file, size: '1x1', w, h,
    created: Date.now()
  };

  await idbPut('aboutMedia', item);
  APP.aboutMedia.push(item);
  window._sheetSelectedItemId = id;

  const tip = document.getElementById('sheetUploadTip');
  if(tip){
    tip.style.display = 'block';
    tip.textContent = '✓ 已选择新上传项: ' + item.title;
  }
  toast('图片已载入！');
}

async function confirmAddSheet(){
  const itemId = window._sheetSelectedItemId;
  if(!itemId){
    toast('请先选择或上传一张图片！');
    return;
  }

  const desk = document.getElementById('aboutDesk');
  const dw = desk.clientWidth - 260;
  const dh = desk.clientHeight - 340;

  const sheet = {
    id: 'sh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    branchId: APP.activeBranch,
    itemId: itemId,
    scale: document.getElementById('sheetScaleInput').value,
    ratio: 'auto',
    tags: [],
    x: 40 + Math.random() * Math.max(20, dw),
    y: 40 + Math.random() * Math.max(20, dh),
    rot: (Math.random() * 12 - 6),
    z: Date.now(),
    created: Date.now()
  };

  await idbPut('sheets', sheet);
  APP.sheets.push(sheet);
  closeModal();
  renderBranches();
  renderSheets();
  toast('SHEET 已添加至桌面！', true);
}

async function deleteSheet(id){
  await idbDel('sheets', id);
  APP.sheets = APP.sheets.filter(s => s.id !== id);
  renderBranches();
  renderSheets();
  renderAboutTags();
  toast('已删除', true);
}

function openSheetEditor(sheetId){
  const sheet = APP.sheets.find(s => s.id === sheetId);
  if(!sheet) return;
  const item = APP.aboutMedia.find(it => it.id === sheet.itemId);
  if(!item) return;

  const branchOptions = APP.branches.map(b =>
    `<option value="${b.id}" ${b.id === sheet.branchId ? 'selected' : ''}>${esc(b.name)}</option>`
  ).join('');

  const curScale = sheet.scale || 'md';
  const curRatio = sheet.ratio || 'auto';

  const body = `
    <div class="field">
      <label class="field__label">所属分支 / 文件夹 (移入其他分支)</label>
      <select class="field__input" id="edSheetBranch">${branchOptions}</select>
    </div>
    <div class="field">
      <label class="field__label">尺寸大小 (SCALE)</label>
      <select class="field__input" id="edSheetScale">
        <option value="sm" ${curScale==='sm'?'selected':''}>SMALL 小号 (160px)</option>
        <option value="md" ${curScale==='md'?'selected':''}>MEDIUM 中号 (220px)</option>
        <option value="lg" ${curScale==='lg'?'selected':''}>LARGE 大号 (300px)</option>
        <option value="xl" ${curScale==='xl'?'selected':''}>EXTRA LARGE 特大 (400px)</option>
      </select>
    </div>
    <div class="field">
      <label class="field__label">外形比例 (SHAPE / RATIO)</label>
      <select class="field__input" id="edSheetRatio">
        <option value="auto" ${curRatio==='auto'?'selected':''}>AUTO 原图真实比例 (推荐)</option>
        <option value="1:1" ${curRatio==='1:1'?'selected':''}>1:1 正方形</option>
        <option value="3:4" ${curRatio==='3:4'?'selected':''}>3:4 纵向画册</option>
        <option value="4:3" ${curRatio==='4:3'?'selected':''}>4:3 横向宽幅</option>
      </select>
    </div>
    <div class="field">
      <label class="field__label">SHEET TAGS (逗号分隔)</label>
      <input class="field__input" id="edSheetTags" value="${escAttr((sheet.tags||[]).join(', '))}" placeholder="TAG1, TAG2...">
    </div>
  `;
  openModal('EDIT SHEET', body, `
    <button class="admin-btn" onclick="closeModal()">CANCEL</button>
    <button class="admin-btn admin-btn--danger" onclick="deleteSheet('${sheet.id}');closeModal()">DELETE</button>
    <button class="admin-btn admin-btn--primary" onclick="saveSheet('${sheet.id}')">SAVE</button>
  `);
}

async function saveSheet(id){
  const sheet = APP.sheets.find(s => s.id === id);
  if(!sheet) return;

  const targetBranch = document.getElementById('edSheetBranch').value;
  const isMoved = sheet.branchId !== targetBranch;

  sheet.branchId = targetBranch;
  sheet.scale = document.getElementById('edSheetScale').value;
  sheet.ratio = document.getElementById('edSheetRatio').value;

  const tags = document.getElementById('edSheetTags').value.trim();
  sheet.tags = tags ? tags.split(',').map(t=>t.trim().toUpperCase()).filter(Boolean) : [];

  await idbPut('sheets', sheet);
  closeModal();

  renderBranches();
  renderSheets();
  renderAboutTags();
  toast(isMoved ? '已移入新分支！' : 'SAVED', true);
}

/* ============================================================
   便利贴模块
   ============================================================ */
function openCreateSticky(){
  if(!APP.activeBranch){
    if(APP.branches.length > 0) APP.activeBranch = APP.branches[0].id;
    else { toast('请先新建分支'); return; }
  }
  openStickyEditor(null);
}

function openStickyEditor(stickyId){
  const isEdit = Boolean(stickyId);
  const s = isEdit ? APP.sheets.find(x => x.id === stickyId) : {
    title: '', content: '', color: 'yellow', fontFamily: 'var(--sans)', fontSize: '13px', scale: 'md', ratio: '1:1', tags: []
  };

  const branchOptions = APP.branches.map(b =>
    `<option value="${b.id}" ${b.id === (s.branchId || APP.activeBranch) ? 'selected' : ''}>${esc(b.name)}</option>`
  ).join('');

  const body = `
    <div class="field">
      <label class="field__label">所属分支 / 文件夹</label>
      <select class="field__input" id="edStickyBranch">${branchOptions}</select>
    </div>
    <div class="field">
      <label class="field__label">便利贴标题 (可选)</label>
      <input class="field__input" id="edStickyTitle" value="${escAttr(s.title||'')}" placeholder="IDEA / NOTE">
    </div>
    <div class="field">
      <label class="field__label">便利贴正文内容</label>
      <textarea class="field__input" id="edStickyContent" style="min-height:120px" placeholder="在此输入文字记录灵感...">${esc(s.content||'')}</textarea>
    </div>
    <div class="field">
      <label class="field__label">便利贴底色</label>
      <select class="field__input" id="edStickyColor">
        <option value="yellow" ${s.color==='yellow'?'selected':''}>经典鹅黄 (Yellow)</option>
        <option value="pink" ${s.color==='pink'?'selected':''}>淡樱粉 (Pink)</option>
        <option value="green" ${s.color==='green'?'selected':''}>薄荷绿 (Green)</option>
        <option value="blue" ${s.color==='blue'?'selected':''}>天空蓝 (Blue)</option>
        <option value="dark" ${s.color==='dark'?'selected':''}>暗夜黑 (Dark)</option>
        <option value="classic" ${s.color==='classic'?'selected':''}>极简单色 (Mono)</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field">
        <label class="field__label">字体风格</label>
        <select class="field__input" id="edStickyFont">
          <option value="var(--sans)" ${s.fontFamily==='var(--sans)'?'selected':''}>现代无衬线 (Inter)</option>
          <option value="var(--mono)" ${s.fontFamily==='var(--mono)'?'selected':''}>硬核代码风 (Mono)</option>
          <option value="cursive" ${s.fontFamily==='cursive'?'selected':''}>随性手写体 (Cursive)</option>
          <option value="Georgia, serif" ${s.fontFamily==='Georgia, serif'?'selected':''}>复古衬线 (Serif)</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label">字体大小</label>
        <select class="field__input" id="edStickyFontSize">
          <option value="11px" ${s.fontSize==='11px'?'selected':''}>紧凑 (11px)</option>
          <option value="13px" ${s.fontSize==='13px'?'selected':''}>常规 (13px)</option>
          <option value="15px" ${s.fontSize==='15px'?'selected':''}>醒目 (15px)</option>
          <option value="18px" ${s.fontSize==='18px'?'selected':''}>大字号 (18px)</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field">
        <label class="field__label">尺寸</label>
        <select class="field__input" id="edStickyScale">
          <option value="sm" ${s.scale==='sm'?'selected':''}>小贴纸 (160px)</option>
          <option value="md" ${s.scale==='md'?'selected':''}>中号便签 (220px)</option>
          <option value="lg" ${s.scale==='lg'?'selected':''}>大号记事板 (300px)</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label">比例形状</label>
        <select class="field__input" id="edStickyRatio">
          <option value="1:1" ${s.ratio==='1:1'?'selected':''}>1:1 正方形</option>
          <option value="3:4" ${s.ratio==='3:4'?'selected':''}>3:4 纵向</option>
          <option value="4:3" ${s.ratio==='4:3'?'selected':''}>4:3 横向</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label class="field__label">涂鸦手绘 <button class="scribble-toggle" id="scribbleToggle" onclick="toggleScribble()">展开画板</button></label>
      <div class="scribble-wrap" id="scribbleWrap" style="display:none">
        <div class="scribble-toolbar">
          <span class="scribble-color-btn is-active" data-color="#000" style="background:#000" onclick="setScribbleColor('#000',this)"></span>
          <span class="scribble-color-btn" data-color="#c44" style="background:#c44" onclick="setScribbleColor('#c44',this)"></span>
          <span class="scribble-color-btn" data-color="#4a4" style="background:#4a4" onclick="setScribbleColor('#4a4',this)"></span>
          <span class="scribble-color-btn" data-color="#48c" style="background:#48c" onclick="setScribbleColor('#48c',this)"></span>
          <span class="scribble-color-btn" data-color="#f6e05e" style="background:#f6e05e" onclick="setScribbleColor('#f6e05e',this)"></span>
          <input type="range" class="scribble-size-slider" id="scribbleSize" min="1" max="12" value="2" oninput="setScribbleSize(this.value)">
          <button class="scribble-clear-btn" onclick="clearScribble()">CLEAR</button>
        </div>
        <canvas class="scribble-canvas" id="scribbleCanvas"></canvas>
      </div>
    </div>
  `;

  openModal(isEdit ? 'EDIT STICKY NOTE' : 'NEW STICKY NOTE', body, `
    <button class="admin-btn" onclick="closeModal()">CANCEL</button>
    ${isEdit ? `<button class="admin-btn admin-btn--danger" onclick="deleteSheet('${s.id}');closeModal()">DELETE</button>` : ''}
    <button class="admin-btn admin-btn--primary" onclick="saveSticky('${isEdit ? s.id : ''}')">SAVE</button>
  `);

  // 保存当前涂鸦状态（如果有）
  window._scribbleData = s.scribble || null;
}

/* ============================================================
   涂鸦画板 (Scribble Canvas)
   ============================================================ */
let _scribbleActive = false;
let _scribbleDrawing = false;
let _scribbleCtx = null;
let _scribbleColor = '#000';
let _scribbleLineWidth = 2;
let _scribbleLastX = 0;
let _scribbleLastY = 0;

function toggleScribble(){
  const wrap = document.getElementById('scribbleWrap');
  const btn = document.getElementById('scribbleToggle');
  if(wrap.style.display === 'none'){
    wrap.style.display = 'block';
    btn.textContent = '收起画板';
    btn.classList.add('is-on');
    initScribbleCanvas();
  } else {
    wrap.style.display = 'none';
    btn.textContent = '展开画板';
    btn.classList.remove('is-on');
  }
}

function initScribbleCanvas(){
  const canvas = document.getElementById('scribbleCanvas');
  if(!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = 200;
  _scribbleCtx = canvas.getContext('2d');
  _scribbleCtx.fillStyle = '#fff';
  _scribbleCtx.fillRect(0, 0, canvas.width, canvas.height);
  _scribbleCtx.lineCap = 'round';
  _scribbleCtx.lineJoin = 'round';

  // 恢复已有涂鸦
  if(window._scribbleData){
    const img = new Image();
    img.onload = () => { _scribbleCtx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = window._scribbleData;
  }

  canvas.addEventListener('mousedown', (e) => {
    _scribbleDrawing = true;
    const r = canvas.getBoundingClientRect();
    _scribbleLastX = e.clientX - r.left;
    _scribbleLastY = e.clientY - r.top;
  });

  canvas.addEventListener('mousemove', (e) => {
    if(!_scribbleDrawing) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    _scribbleCtx.strokeStyle = _scribbleColor;
    _scribbleCtx.lineWidth = _scribbleLineWidth;
    _scribbleCtx.beginPath();
    _scribbleCtx.moveTo(_scribbleLastX, _scribbleLastY);
    _scribbleCtx.lineTo(x, y);
    _scribbleCtx.stroke();
    _scribbleLastX = x;
    _scribbleLastY = y;
  });

  canvas.addEventListener('mouseup', () => { _scribbleDrawing = false; });
  canvas.addEventListener('mouseleave', () => { _scribbleDrawing = false; });
}

function setScribbleColor(color, el){
  _scribbleColor = color;
  document.querySelectorAll('.scribble-color-btn').forEach(b => b.classList.remove('is-active'));
  if(el) el.classList.add('is-active');
}

function setScribbleSize(val){
  _scribbleLineWidth = parseInt(val);
}

function clearScribble(){
  const canvas = document.getElementById('scribbleCanvas');
  if(!_scribbleCtx || !canvas) return;
  _scribbleCtx.fillStyle = '#fff';
  _scribbleCtx.fillRect(0, 0, canvas.width, canvas.height);
}

function getScribbleData(){
  const canvas = document.getElementById('scribbleCanvas');
  if(!canvas) return null;
  const wrap = document.getElementById('scribbleWrap');
  if(!wrap || wrap.style.display === 'none') return null;
  return canvas.toDataURL('image/png');
}

async function saveSticky(id){
  const desk = document.getElementById('aboutDesk');
  const dw = desk.clientWidth - 260;
  const dh = desk.clientHeight - 340;

  const isEdit = Boolean(id);
  const s = isEdit ? APP.sheets.find(x => x.id === id) : {
    id: 'stk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    isSticky: true,
    created: Date.now(),
    x: 40 + Math.random() * Math.max(10, dw),
    y: 30 + Math.random() * Math.max(10, dh),
    rot: (Math.random() * 12 - 6),
    z: Date.now()
  };

  s.branchId = document.getElementById('edStickyBranch').value;
  s.title = document.getElementById('edStickyTitle').value.trim();
  s.content = document.getElementById('edStickyContent').value.trim();
  s.color = document.getElementById('edStickyColor').value;
  s.fontFamily = document.getElementById('edStickyFont').value;
  s.fontSize = document.getElementById('edStickyFontSize').value;
  s.scale = document.getElementById('edStickyScale').value;
  s.ratio = document.getElementById('edStickyRatio').value;
  s.scribble = getScribbleData() || null;

  await idbPut('sheets', s);
  if(!isEdit) APP.sheets.push(s);

  closeModal();
  renderBranches();
  renderSheets();
  toast(isEdit ? '便利贴已更新' : '便利贴已贴上！', true);
}

async function tidyDesk(){
  const sheets = APP.sheets.filter(s => s.branchId === APP.activeBranch);
  if(!sheets.length) return;

  const desk = document.getElementById('aboutDesk');
  const deskWidth = desk.clientWidth || 800;
  const deskHeight = desk.clientHeight || 600;

  const margin = 20;       // 桌面边距
  const gap = 16;          // 卡片间距
  const topOffset = 50;    // 顶部留空（给工具栏）

  let curX = margin;
  let curY = topOffset;
  let rowMaxH = 0;

  // 先算出每个 sheet 的尺寸
  const sized = sheets.map(s => {
    const item = s.isSticky ? null : APP.aboutMedia.find(it => it.id === s.itemId);
    return { s, item, dim: computeSheetDim(s, item) };
  });

  for(let i = 0; i < sized.length; i++){
    const { s, dim } = sized[i];

    // 如果当前行放不下了，换行
    if(curX + dim.w > deskWidth - margin && i > 0){
      curX = margin;
      curY += rowMaxH + gap;
      rowMaxH = 0;
    }

    s.x = curX;
    s.y = curY;
    s.rot = 0;

    curX += dim.w + gap;
    if(dim.h > rowMaxH) rowMaxH = dim.h;

    await idbPut('sheets', s);
  }

  renderSheets();
  toast('已整理对齐！', true);
}

async function scatterDesk(){
  const sheets = APP.sheets.filter(s => s.branchId === APP.activeBranch);
  if(!sheets.length) return;

  const desk = document.getElementById('aboutDesk');
  const margin = 20;
  const topOffset = 50;
  const dw = Math.max(40, (desk.clientWidth || 800) - 280 - margin);
  const dh = Math.max(40, (desk.clientHeight || 600) - topOffset - margin - 40);

  for(let i = 0; i < sheets.length; i++){
    const s = sheets[i];
    const item = s.isSticky ? null : APP.aboutMedia.find(it => it.id === s.itemId);
    const dim = computeSheetDim(s, item);
    s.rot = Math.round((Math.random() * 18 - 9) * 10) / 10;
    s.x = Math.round(margin + Math.random() * Math.max(20, dw - dim.w));
    s.y = Math.round(topOffset + Math.random() * Math.max(20, dh - dim.h));
    // 不重置 z — 保持"最近拖动的在最上层"的层级关系

    await idbPut('sheets', s);
  }

  renderSheets();
  toast('已散乱排布！', true);
}

/* ============================================================
   初始摆放：保存当前布局为初始状态 / 恢复到初始状态
   ============================================================ */
async function saveDeskLayout(){
  if(!APP.activeBranch) return;
  const sheets = APP.sheets.filter(s => s.branchId === APP.activeBranch);
  if(!sheets.length){ toast('当前分支无内容'); return; }

  const layout = sheets.map(s => ({
    id: s.id, x: s.x, y: s.y, rot: s.rot, z: s.z,
    scale: s.scale, ratio: s.ratio
  }));

  APP.deskLayouts[APP.activeBranch] = layout;

  const meta = {key: 'deskLayouts', value: APP.deskLayouts};
  await idbPut('meta', meta);

  toast('初始摆放已保存！', true);
}

async function restoreDeskLayout(){
  if(!APP.activeBranch) return;
  const layout = APP.deskLayouts[APP.activeBranch];
  if(!layout || !layout.length){ toast('未设置初始摆放'); return; }

  for(const snap of layout){
    const s = APP.sheets.find(x => x.id === snap.id);
    if(!s) continue;
    s.x = snap.x; s.y = snap.y; s.rot = snap.rot; s.z = snap.z;
    if(snap.scale) s.scale = snap.scale;
    if(snap.ratio) s.ratio = snap.ratio;
    await idbPut('sheets', s);
  }

  renderSheets();
  toast('已恢复到初始摆放！', true);
}

function renderAboutTags(){
  const wrap = document.getElementById('aboutTags');
  const sheets = APP.sheets.filter(s => s.branchId === APP.activeBranch);
  const tags = {};
  sheets.forEach(s => (s.tags||[]).forEach(t => tags[t] = (tags[t]||0)+1));
  wrap.innerHTML = '';
  Object.keys(tags).sort().forEach(t => {
    const el = document.createElement('span');
    el.className = 'about-tag-filter';
    el.textContent = t + ' (' + tags[t] + ')';
    el.onclick = () => {
      const inp = document.getElementById('aboutSearch');
      inp.value = inp.value.includes(t) ? inp.value.replace(t,'').trim() : (inp.value + ' ' + t).trim();
      APP.aboutSearch = inp.value;
      filterSheets();
    };
    wrap.appendChild(el);
  });
}

function filterSheets(){
  const inp = document.getElementById('aboutSearch');
  APP.aboutSearch = inp.value;
  const search = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  document.querySelectorAll('.sheet').forEach(el => {
    const sheet = APP.sheets.find(s => s.id === el.dataset.id);
    if(!sheet){ el.classList.add('is-filtered-out'); return; }
    if(!search.length){
      el.classList.remove('is-filtered-out');
    } else {
      const matches = search.every(st => (sheet.tags||[]).some(t => t.toLowerCase().includes(st)));
      el.classList.toggle('is-filtered-out', !matches);
    }
  });
}

/* ============================================================
   ARTICLES
   ============================================================ */
function renderArticles(){
  if(!APP.activeArticleFolder && APP.articleFolders.length > 0){
    APP.activeArticleFolder = APP.articleFolders[0].id;
  }

  renderArticleFolders();
  if(APP.activeArticleFolder){
    renderArticleList();
  } else {
    document.getElementById('articlesContent').innerHTML = '<div class="articles-empty"><p>Select or create a folder to start writing.</p></div>';
  }
}

function renderArticleFolders(){
  const list = document.getElementById('articleFolderList');
  list.innerHTML = '';
  APP.articleFolders.forEach(f => {
    const el = document.createElement('div');
    el.className = 'article-folder' + (APP.activeArticleFolder===f.id ? ' is-active' : '');
    const count = APP.articles.filter(a => a.folderId === f.id).length;
    el.dataset.cursorTitle = f.name;
    el.innerHTML = `<span class="article-folder__name">${esc(f.name)}</span><span class="article-folder__count">${count}</span>`;
    
    const rename = document.createElement('span');
    rename.className = 'article-folder__rename';
    rename.textContent = '✎';
    rename.onclick = (e) => { e.stopPropagation(); renameArticleFolder(f.id); };
    el.appendChild(rename);

    const del = document.createElement('span');
    del.className = 'article-folder__del';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteArticleFolder(f.id); };
    el.appendChild(del);

    el.onclick = () => selectArticleFolder(f.id);
    list.appendChild(el);
  });
  const foot = document.getElementById('articleSidebarFoot');
  if(APP.activeArticleFolder){
    const f = APP.articleFolders.find(x => x.id === APP.activeArticleFolder);
    foot.textContent = (f ? f.name : '') + ' · ' + APP.articles.filter(a=>a.folderId===APP.activeArticleFolder).length + ' DOCS';
  } else {
    foot.textContent = 'SELECT A FOLDER';
  }
}

async function addArticleFolder(){
  const name = await prompt2('Folder name:', 'NEW FOLDER');
  if(!name) return;
  const f = {id: 'af_'+Date.now().toString(36), name: name.toUpperCase(), created: Date.now()};
  await idbPut('articleFolders', f);
  APP.articleFolders.push(f);
  selectArticleFolder(f.id);
  toast('FOLDER CREATED', true);
}

async function renameArticleFolder(id){
  const f = APP.articleFolders.find(x => x.id === id);
  if(!f) return;
  const name = await prompt2('New name:', 'RENAME FOLDER', f.name);
  if(!name) return;
  f.name = name.toUpperCase();
  await idbPut('articleFolders', f);
  renderArticleFolders();
  toast('RENAMED', true);
}

async function deleteArticleFolder(id){
  if(!await confirm2('Delete this folder and all its articles?')) return;
  await idbDel('articleFolders', id);
  const arts = APP.articles.filter(a => a.folderId === id);
  for(const a of arts) await idbDel('articles', a.id);
  APP.articleFolders = APP.articleFolders.filter(f => f.id !== id);
  APP.articles = APP.articles.filter(a => a.folderId !== id);
  APP.activeArticleFolder = APP.articleFolders.length ? APP.articleFolders[0].id : null;
  renderArticles();
  toast('FOLDER DELETED', true);
}

function selectArticleFolder(id){
  APP.activeArticleFolder = id;
  renderArticles();
}

function renderArticleList(){
  const content = document.getElementById('articlesContent');
  const folder = APP.articleFolders.find(f => f.id === APP.activeArticleFolder);
  const docs = APP.articles.filter(a => a.folderId === APP.activeArticleFolder).sort((a,b) => (b.updated||0) - (a.updated||0));

  let html = '<div class="articles-list">';
  html += '<div class="articles-list__header">';
  html += '<span class="articles-list__title">' + esc(folder ? folder.name : 'FOLDER') + '</span>';
  html += '</div>';

  if(!docs.length){
    html += '<div class="articles-empty"><p>No articles in this folder.</p></div>';
  } else {
    docs.forEach(d => {
      const excerpt = stripHtml(d.content || '').slice(0, 80);
      const dateStr = formatDate(d.updated || d.created);
      const lockedIcon = d.locked ? '🔒' : '📄';
      html += '<div class="doc-card" onclick="openArticleReader(\'' + d.id + '\')" data-cursor-title="' + escAttr(d.title || 'UNTITLED') + '">';
      html += '<span class="doc-card__icon ' + (d.locked ? 'doc-card__icon--locked' : '') + '">' + lockedIcon + '</span>';
      html += '<div class="doc-card__body">';
      html += '<div class="doc-card__title">' + esc(d.title || 'UNTITLED') + '</div>';
      if(excerpt) html += '<div class="doc-card__excerpt">' + esc(excerpt) + '</div>';
      html += '<div class="doc-card__meta">' + dateStr + (d.locked ? ' · LOCKED' : ' · DRAFT') + '</div>';
      html += '</div>';
      html += '<span class="doc-card__action">OPEN</span>';
      html += '</div>';
    });
  }
  html += '</div>';
  content.innerHTML = html;

  requestAnimationFrame(() => {
    content.querySelectorAll('.doc-card').forEach((el, i) => {
      setTimeout(() => el.classList.add('is-in'), i * 50);
    });
  });
}

async function createArticle(){
  if(!APP.activeArticleFolder) return;
  const id = 'ar_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  const article = {
    id, folderId: APP.activeArticleFolder,
    title: 'UNTITLED', content: '',
    locked: false, fontSize: 'medium',
    created: Date.now(), updated: Date.now()
  };
  await idbPut('articles', article);
  APP.articles.push(article);
  openArticleReader(id, true);
  toast('ARTICLE CREATED', true);
}

async function deleteArticle(id){
  if(!await confirm2('Delete this article permanently?')) return;
  await idbDel('articles', id);
  APP.articles = APP.articles.filter(a => a.id !== id);
  renderArticleList();
  renderArticleFolders();
  toast('ARTICLE DELETED', true);
}

async function toggleArticleLock(id){
  const a = APP.articles.find(x => x.id === id);
  if(!a) return;
  a.locked = !a.locked;
  a.updated = Date.now();
  await idbPut('articles', a);
  renderArticleList();
  toast(a.locked ? 'ARTICLE LOCKED — READ ONLY' : 'ARTICLE UNLOCKED', true);
}

function openArticleReader(id, editMode){
  const a = APP.articles.find(x => x.id === id);
  if(!a) return;
  APP.activeArticle = id;
  APP.articleEditMode = false; // VIEW ONLY

  const reader = document.getElementById('articleReader');
  const body = document.getElementById('articleReaderBody');
  const actions = document.getElementById('articleReaderActions');
  const titleBar = document.getElementById('articleReaderTitle');

  titleBar.textContent = a.title || 'UNTITLED';
  reader.classList.toggle('is-locked', a.locked);
  reader.classList.add('is-open');
  document.body.classList.add('modal-open');

  actions.innerHTML = '<span class="article-reader__readonly">◈ READ ONLY</span>';
  body.innerHTML = buildReaderHTML(a);
  generateTOC();
  reader.scrollTop = 0;
}

function buildReaderHTML(a){
  const fontSel = a.fontSize || 'medium';
  return `
    <h1 class="article-reader__doc-title" id="docTitleDisplay">${esc(a.title || 'UNTITLED')}</h1>
    <div class="article-reader__doc-meta">${formatDate(a.updated||a.created)} · ${a.locked ? 'LOCKED' : 'DRAFT'}</div>
    <div class="article-reader__content" id="articleContent" data-font="${fontSel}">${a.content || '<p style="color:var(--fg-dim)">No content yet.</p>'}</div>
  `;
}

function buildEditorHTML(a){
  const fontSel = a.fontSize || 'medium';
  return `
    <div class="field" style="margin-bottom:10px">
      <input class="field__input" id="articleTitleInput" value="${escAttr(a.title||'')}" placeholder="Article Title" style="font-size:18px;font-weight:700;background:transparent;border:none;border-bottom:1px solid var(--line);padding:4px 0">
    </div>
    <div class="editor-toolbar" id="editorToolbar">
      <select class="editor-select" id="fontSizeSel" onchange="setArticleFont(this.value)">
        <option value="small"${fontSel==='small'?' selected':''}>SMALL</option>
        <option value="medium"${fontSel==='medium'?' selected':''}>MEDIUM</option>
        <option value="large"${fontSel==='large'?' selected':''}>LARGE</option>
        <option value="xlarge"${fontSel==='xlarge'?' selected':''}>X-LARGE</option>
      </select>
      <div class="editor-divider"></div>
      <button class="editor-btn" onclick="execEditor('bold')"><b>B</b></button>
      <button class="editor-btn" onclick="execEditor('italic')"><i>I</i></button>
      <button class="editor-btn" onclick="execEditor('underline')"><u>U</u></button>
      <button class="editor-btn" onclick="execEditor('strikeThrough')"><s>S</s></button>
      <div class="editor-divider"></div>
      <button class="editor-btn" onclick="execEditor('formatBlock','<h1>')">H1</button>
      <button class="editor-btn" onclick="execEditor('formatBlock','<h2>')">H2</button>
      <button class="editor-btn" onclick="execEditor('formatBlock','<h3>')">H3</button>
      <button class="editor-btn" onclick="execEditor('formatBlock','<p>')">P</button>
      <div class="editor-divider"></div>
      <button class="editor-btn" onclick="execEditor('insertUnorderedList')">•</button>
      <button class="editor-btn" onclick="execEditor('insertOrderedList')">1.</button>
      <button class="editor-btn" onclick="execEditor('formatBlock','<blockquote>')">"</button>
    </div>
    <div class="article-reader__content article-editor" id="articleEditor" contenteditable="true" data-font="${fontSel}" data-placeholder="Start writing..." oninput="updateTOC()">${a.content || ''}</div>
  `;
}

function initEditor(){
  const editor = document.getElementById('articleEditor');
  if(!editor) return;
  
  // 拦截粘贴事件：自动清除外部复制带来的黑字/背景色内联样式
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  setTimeout(() => editor.focus(), 200);
}

function execEditor(cmd, val){
  document.execCommand(cmd, false, val || null);
  document.getElementById('articleEditor')?.focus();
  updateTOC();
}

function setArticleFont(size){
  const editor = document.getElementById('articleEditor');
  if(editor) editor.dataset.font = size;
}

function generateTOC(){
  const content = document.getElementById('articleContent');
  const toc = document.getElementById('articleToc');
  if(!content || !toc) return;
  const headings = content.querySelectorAll('h1, h2, h3');
  if(!headings.length){
    toc.classList.remove('is-visible');
    return;
  }
  let html = '<div class="article-toc__title">CONTENTS</div>';
  headings.forEach((h, i) => {
    h.id = 'hd_' + i;
    const tag = h.tagName.toLowerCase();
    const cls = tag === 'h1' ? '' : (tag === 'h2' ? ' article-toc__item--h2' : ' article-toc__item--h3');
    html += '<a class="article-toc__item'+cls+'" onclick="scrollToHeading('+i+')">'+esc(h.textContent)+'</a>';
  });
  toc.innerHTML = html;
  toc.classList.add('is-visible');
}

function scrollToHeading(idx){
  const el = document.getElementById('hd_'+idx);
  if(el){
    document.getElementById('articleReader').scrollTo({top: el.offsetTop - 80, behavior: 'smooth'});
  }
}

function updateTOC(){
  clearTimeout(window._tocTimer);
  window._tocTimer = setTimeout(() => {
    const editor = document.getElementById('articleEditor');
    const toc = document.getElementById('articleToc');
    if(!editor || !toc) return;
    const headings = editor.querySelectorAll('h1, h2, h3');
    if(!headings.length){
      toc.classList.remove('is-visible');
      return;
    }
    let html = '<div class="article-toc__title">CONTENTS</div>';
    headings.forEach((h, i) => {
      const tag = h.tagName.toLowerCase();
      const cls = tag === 'h1' ? '' : (tag === 'h2' ? ' article-toc__item--h2' : ' article-toc__item--h3');
      html += '<a class="article-toc__item'+cls+'">'+esc(h.textContent)+'</a>';
    });
    toc.innerHTML = html;
    toc.classList.add('is-visible');
  }, 400);
}

async function saveArticle(){
  const a = APP.articles.find(x => x.id === APP.activeArticle);
  if(!a) return;
  const titleInput = document.getElementById('articleTitleInput');
  const editor = document.getElementById('articleEditor');
  if(titleInput) a.title = titleInput.value.trim() || 'UNTITLED';
  if(editor) a.content = editor.innerHTML;
  a.fontSize = document.getElementById('fontSizeSel')?.value || 'medium';
  a.updated = Date.now();
  await idbPut('articles', a);
  toast('ARTICLE SAVED', true);
  renderArticleFolders();
  setTimeout(() => closeArticleReader(), 400);
}

function closeSheet(){
  unfocusAllSheets();
}

function closeArticleReader(){
  document.getElementById('articleReader').classList.remove('is-open', 'is-locked');
  document.getElementById('articleToc').classList.remove('is-visible');
  document.body.classList.remove('modal-open');
  APP.activeArticle = null;
  APP.articleEditMode = false;
  if(APP.view === 'articles') renderArticleList();
}

function stripHtml(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').trim();
}

function formatDate(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return months[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
}

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escAttr(s){return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

/* ============================================================
   UPLOAD
   ============================================================ */
function openUpload(){
  const body = `
    <div class="upload-dropzone" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <p style="font-size:14px;margin-bottom:6px">DRAG FILES HERE</p>
      <p style="font-size:10px;opacity:.6">or click to browse · images & videos</p>
    </div>
    <input type="file" id="fileInput" accept="image/*,video/*" multiple style="display:none">
  `;
  openModal('UPLOAD MEDIA', body, `<button class="admin-btn" onclick="closeModal()">CLOSE</button>`);
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  fi.onchange = (e) => doUpload(e.target.files);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('is-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('is-over');
    doUpload(e.dataTransfer.files);
  });
}

async function doUpload(files){
  if(!files || !files.length) return;
  for(const file of files){
    const isVideo = file.type.startsWith('video/');
    if(!isVideo && !file.type.startsWith('image/')) continue;
    const id = 'it_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
    const item = {
      id, type: isVideo?'video':'image',
      title: file.name.replace(/\.[^.]+$/,'').toUpperCase(),
      tags: [], note: '', blob: file, size: '1x1',
      created: Date.now()
    };
    await idbPut('media', item);
    APP.items.push(item);
  }
  closeModal();
  renderProjects();
  if(APP.view==='about') renderAbout();
  toast('UPLOADED '+files.length+' FILE'+(files.length>1?'S':''), true);
  updateStorageInfo();
}

/* ============================================================
   AUDIO
   ============================================================ */
function formatTime(s){
  if(!s) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m+':'+String(sec).padStart(2,'0');
}

function openAudioManager(){
  let list = APP.audio.map((a) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)">
      <button class="admin-btn" onclick="playAudio('${a.id}')">▶</button>
      <span style="flex:1;font-size:11px">${esc(a.name)}</span>
      <button class="admin-btn admin-btn--danger" onclick="deleteAudio('${a.id}')">✕</button>
    </div>
  `).join('');
  if(!list) list = '<div style="text-align:center;padding:20px;color:var(--fg-dim);font-size:11px">No audio tracks yet.</div>';
  openModal('AUDIO LIBRARY', `
    ${list}
    <div style="margin-top:14px">
      <input type="file" id="audioInput" accept="audio/*" style="display:none">
      <button class="admin-btn admin-btn--primary" onclick="document.getElementById('audioInput').click()">+ ADD AUDIO</button>
    </div>
  `, `<button class="admin-btn" onclick="closeModal()">CLOSE</button>`);
  document.getElementById('audioInput').onchange = doAudioUpload;
}

async function doAudioUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  const id = 'au_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  const rec = {id, name: file.name.replace(/\.[^.]+$/,''), blob: file};
  await idbPut('audio', rec);
  APP.audio.push(rec);
  closeModal();
  openAudioManager();
  syncAudioButton();
  toast('AUDIO ADDED', true);
}

async function deleteAudio(id){
  await idbDel('audio', id);
  APP.audio = APP.audio.filter(a => a.id !== id);
  openAudioManager();
  syncAudioButton();
  toast('AUDIO REMOVED', true);
}

function playAudio(id){
  const a = APP.audio.find(x => x.id === id);
  if(!a) return;
  const el = document.getElementById('audioEl');
  el.src = blobUrl(a.blob);
  el.play();
  document.getElementById('audioPlayer').classList.add('is-visible');
  document.getElementById('audioTitle').textContent = a.name;
}

function toggleAudio(){
  const el = document.getElementById('audioEl');
  if(el.paused){ el.play(); document.getElementById('audioToggle').textContent = '❚❚'; }
  else { el.pause(); document.getElementById('audioToggle').textContent = '▶'; }
}

function toggleAudioPanel(){
  document.getElementById('audioList').classList.toggle('is-open');
  renderAudioList();
}

function renderAudioList(){
  const list = document.getElementById('audioList');
  list.innerHTML = '';
  APP.audio.forEach(a => {
    const el = document.createElement('div');
    el.className = 'audio-player__track';
    el.innerHTML = `<span style="flex:1">${esc(a.name)}</span>`;
    el.onclick = () => playAudio(a.id);
    list.appendChild(el);
  });
}

function syncAudioButton(){
  document.getElementById('audioToggleBtn').style.display = APP.audio.length ? '' : 'none';
}

function seekAudio(e){
  const el = document.getElementById('audioEl');
  const seek = document.getElementById('audioSeek');
  const rect = seek.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  if(el.duration) el.currentTime = el.duration * pct;
}

/* ============================================================
   MODAL & PROMPT
   ============================================================ */
function openModal(title, body, footer){
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFooter').innerHTML = footer || '';
  document.getElementById('modal').classList.add('is-open');
  document.getElementById('modalOverlay').classList.add('is-open');
  document.body.classList.add('modal-open');
}

function closeModal(){
  document.getElementById('modal').classList.remove('is-open');
  document.getElementById('modalOverlay').classList.remove('is-open');
  document.body.classList.remove('modal-open');
  if(window._promptResolve){
    const r = window._promptResolve;
    window._promptResolve = null;
    r(null);
  }
  if(window._confirmResolve){
    const r = window._confirmResolve;
    window._confirmResolve = null;
    r(false);
  }
}

function prompt2(message, title, defaultVal){
  return new Promise(resolve => {
    window._promptResolve = resolve;
    openModal(title || 'INPUT', `
      <div class="field">
        <label class="field__label">${esc(message)}</label>
        <input class="field__input" id="promptInput" value="${escAttr(defaultVal||'')}" autocomplete="off" style="font-size:14px;padding:10px">
      </div>
    `, `
      <button class="admin-btn" onclick="closeModal()">CANCEL</button>
      <button class="admin-btn admin-btn--primary" onclick="submitPrompt()">OK</button>
    `);
    setTimeout(() => {
      const inp = document.getElementById('promptInput');
      if(inp){
        inp.focus();
        inp.select();
        inp.onkeydown = e => {
          if(e.key === 'Enter'){
            e.preventDefault();
            submitPrompt();
          }
        };
      }
    }, 100);
  });
}

function submitPrompt(){
  const inp = document.getElementById('promptInput');
  const val = inp ? inp.value.trim() : '';
  const r = window._promptResolve;
  window._promptResolve = null;
  closeModal();
  if(r) r(val);
}

function confirm2(message){
  return new Promise(resolve => {
    openModal('CONFIRM', `<div style="font-size:12px;line-height:1.6;padding:6px 0">${esc(message)}</div>`, `
      <button class="admin-btn" onclick="closeModal();window._confirmResolve(false)">CANCEL</button>
      <button class="admin-btn admin-btn--danger" onclick="closeModal();window._confirmResolve(true)">CONFIRM</button>
    `);
    window._confirmResolve = resolve;
  });
}

/* ============================================================
   CONTACT
   ============================================================ */
function openContact(){
  const line = '3360513967@qq.com';
  openModal('CONTACT', `
    <div style="font-size:12px;line-height:2">
      <p style="margin-bottom:14px">Mail / social / commission enquiries.</p>
      <div style="font-family:var(--mono);font-size:13px;letter-spacing:.08em">${esc(line)}</div>
    </div>
  `, `<button class="admin-btn" onclick="closeModal()">CLOSE</button>`);
}

/* ============================================================
   EXPORT / IMPORT
   ============================================================ */
function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64){
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const uInt8Array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) uInt8Array[i] = raw.charCodeAt(i);
  return new Blob([uInt8Array], { type: contentType });
}

function openExport(){
  openModal('EXPORT BACKUP', `
    <p style="font-size:11px;line-height:1.6;margin-bottom:14px">
      一键将所有高清图片实体、多图画册、文章与分支打包为单文件 <code>.json</code>，换设备直接导入恢复。
    </p>
  `, `
    <button class="admin-btn admin-btn--primary" onclick="doExportFullBundle()">↓ 导出完整备份 (.JSON)</button>
    <button class="admin-btn" onclick="closeModal()">CLOSE</button>
  `);
}

async function doExportFullBundle(){
  toast('正在打包全部图片与文章...');
  try {
    const bundleItems = [];
    for(const it of APP.items){
      let b64 = '';
      if(it.blob) b64 = await blobToBase64(it.blob);
      const galleryB64 = [];
      if(it.gallery && it.gallery.length){
        for(const subBlob of it.gallery) galleryB64.push(await blobToBase64(subBlob));
      }
      bundleItems.push({
        id: it.id, type: it.type, title: it.title, tags: it.tags,
        note: it.note, size: getItemSize(it), base64: b64,
        galleryBase64: galleryB64, created: it.created
      });
    }

    const bundleAboutItems = [];
    for(const it of APP.aboutMedia){
      let b64 = '';
      if(it.blob) b64 = await blobToBase64(it.blob);
      bundleAboutItems.push({
        id: it.id, type: it.type, title: it.title, tags: it.tags,
        note: it.note, w: it.w, h: it.h, base64: b64, created: it.created
      });
    }

    const payload = {
      app: 'MAUVOISIN', version: 2,
      exportDate: new Date().toISOString(),
      items: bundleItems, aboutMedia: bundleAboutItems,
      branches: APP.branches, sheets: APP.sheets,
      articleFolders: APP.articleFolders, articles: APP.articles, theme: APP.theme,
      deskLayouts: APP.deskLayouts
    };

    const jsonStr = JSON.stringify(payload);
    const fileBlob = new Blob([jsonStr], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `MAUVOISIN_BACKUP_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    closeModal();
    toast('备份已导出！', true);
  } catch(err){
    toast('导出失败');
  }
}

function openImport(){
  openModal('IMPORT DATA', `
    <p style="font-size:11px;line-height:1.6;margin-bottom:14px">选择导出的 <code>.json</code> 文件无损还原所有数据：</p>
    <input type="file" id="importInput" accept=".json" class="field__input">
  `, `<button class="admin-btn" onclick="closeModal()">CANCEL</button>`);
  document.getElementById('importInput').onchange = doImport;
}

async function doImport(e){
  const f = e.target.files[0];
  if(!f) return;
  toast('正在还原数据...');
  try {
    const m = JSON.parse(await f.text());
    if(m.items && m.items.length){
      for(const row of m.items){
        let blob = row.base64 ? base64ToBlob(row.base64) : null;
        const extraBlobs = [];
        if(row.galleryBase64 && row.galleryBase64.length){
          for(const gb64 of row.galleryBase64) extraBlobs.push(base64ToBlob(gb64));
        }
        const item = {
          id: row.id, type: row.type || 'image', title: row.title || '',
          tags: row.tags || [], note: row.note || '', size: row.size || '1x1',
          blob: blob, gallery: extraBlobs, created: row.created || Date.now()
        };
        await idbPut('media', item);
      }
    }
    if(m.aboutMedia && m.aboutMedia.length){
      for(const row of m.aboutMedia){
        let blob = row.base64 ? base64ToBlob(row.base64) : null;
        const item = {
          id: row.id, type: row.type || 'image', title: row.title || '',
          tags: row.tags || [], note: row.note || '',
          blob: blob, w: row.w, h: row.h, created: row.created || Date.now()
        };
        await idbPut('aboutMedia', item);
      }
    }
    if(m.branches) for(const b of m.branches) await idbPut('branches', b);
    if(m.sheets) for(const s of m.sheets) await idbPut('sheets', s);
    if(m.articleFolders) for(const af of m.articleFolders) await idbPut('articleFolders', af);
    if(m.articles) for(const ar of m.articles) await idbPut('articles', ar);
    closeModal();
    toast('恢复成功！', true);
    setTimeout(() => location.reload(), 600);
  } catch(err){
    toast('导入解析失败');
  }
}

/* ============================================================
   STORAGE INFO
   ============================================================ */
function updateStorageInfo(){ const el = document.getElementById("storageInfo"); if(el) el.textContent = APP.items.length + APP.aboutMedia.length + " ITEMS"; }

/* ============================================================
   CLOCK & NAVIGATION
   ============================================================ */
function tickClock(){
  const d = new Date();
  document.getElementById('clock').textContent =
    String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
}

function switchView(view){
  APP.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  document.getElementById('view-'+view).classList.add('is-active');
  document.querySelectorAll('.header__nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.nav===view));
  if(view==='about') renderAbout();
  if(view==='projects') renderProjects();
  if(view==='articles') renderArticles();
}
function goHome(){
  switchView('projects');
  window.scrollTo({top:0, behavior:'smooth'});
}

let toastTimer = null;
function toast(msg, ok){
  const t = document.getElementById('toast');
  t.textContent = msg + (ok?' ✓':'');
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200);
}

/* ============================================================
   SEED DEMO (默认带两张图片分支和一张便利贴)
   ============================================================ */
// seedDemo removed in deploy version

/* ============================================================
   INIT
   ============================================================ */
async function init(){
  try {
    const resp = await fetch('data.json');
    if(!resp.ok) throw new Error('data.json not found');
    const data = await resp.json();

    APP.items = (data.items || []).map(it => ({ ...it, blob: null }));
    APP.aboutMedia = (data.aboutMedia || []).map(it => ({ ...it, blob: null }));
    APP.branches = data.branches || [];
    APP.sheets = data.sheets || [];
    APP.articleFolders = data.articleFolders || [];
    APP.articles = data.articles || [];
    APP.deskLayouts = data.deskLayouts || {};
    APP.theme = localStorage.getItem(THEME_KEY) || data.theme || 'dark';
  } catch(err) {
    console.error('Failed to load data.json:', err);
    APP.items = []; APP.aboutMedia = [];
    APP.theme = localStorage.getItem(THEME_KEY) || 'dark';
  }

  applyTheme();

  if(APP.branches.length > 0) APP.activeBranch = APP.branches[0].id;
  if(APP.articleFolders.length > 0) APP.activeArticleFolder = APP.articleFolders[0].id;

  computeUnit();
  renderProjects();
  syncAudioButton();
  renderAudioList();

  tickClock();
  setInterval(tickClock, 1000);
  initCursor();
  initDragHandlers();
  initReorderHandlers();

  let wasMobile = isMobileLayout();
  window.addEventListener('resize', () => {
    computeUnit();
    renderProjects();
    if(isMobileLayout() !== wasMobile){
      wasMobile = isMobileLayout();
      if(APP.view === 'about') renderSheets();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

/* ============================================================
   WINDOW EXPORTS
   ============================================================ */
window.toast = toast;
window.submitPrompt = submitPrompt;
window.switchView = switchView;
window.goHome = goHome;
window.toggleTheme = toggleTheme;
window.openUpload = openUpload;
window.openAudioManager = openAudioManager;
window.openExport = openExport;
window.openImport = openImport;
window.openContact = openContact;
window.closeModal = closeModal;
window.closeViewer = closeViewer;
window.viewerNext = viewerNext;
window.viewerPrev = viewerPrev;
window.clearFilter = clearFilter;
window.toggleReorder = toggleReorder;
window.setGalleryCols = setGalleryCols;
window.cycleItemSize = cycleItemSize;
window.openItemEditor = openItemEditor;
window.saveItem = saveItem;
window.deleteItem = deleteItem;
window.addTagToViewer = addTagToViewer;
window.removeTagFromViewer = removeTagFromViewer;
window.handleAddSubImages = handleAddSubImages;
window.removeSubImage = removeSubImage;
window.toggleAudio = toggleAudio;
window.toggleAudioPanel = toggleAudioPanel;
window.playAudio = playAudio;
window.deleteAudio = deleteAudio;
window.seekAudio = seekAudio;
window.doExportFullBundle = doExportFullBundle;
window.addBranch = addBranch;
window.renameBranch = renameBranch;
window.deleteBranch = deleteBranch;
window.selectBranch = selectBranch;
window.addSheet = addSheet;
window.selectItemForSheet = selectItemForSheet;
window.handleSheetDirectUpload = handleSheetDirectUpload;
window.confirmAddSheet = confirmAddSheet;
window.tidyDesk = tidyDesk;
window.scatterDesk = scatterDesk;
window.saveDeskLayout = saveDeskLayout;
window.restoreDeskLayout = restoreDeskLayout;
window.openCreateSticky = openCreateSticky;
window.openStickyEditor = openStickyEditor;
window.saveSticky = saveSticky;
window.toggleScribble = toggleScribble;
window.setScribbleColor = setScribbleColor;
window.setScribbleSize = setScribbleSize;
window.clearScribble = clearScribble;
window.deleteSheet = deleteSheet;
window.openSheetEditor = openSheetEditor;
window.saveSheet = saveSheet;
window.filterSheets = filterSheets;
window.closeSheet = closeSheet;
window.focusSheet = focusSheet;
window.unfocusAllSheets = unfocusAllSheets;
window.toggleBind = toggleBind;
window.openArchiveUpload = openArchiveUpload;
window.confirmArchiveUpload = confirmArchiveUpload;
window.openArchiveViewer = openArchiveViewer;
window.archiveViewerNav = archiveViewerNav;
window.closeArchiveViewer = closeArchiveViewer;
window.addArticleFolder = addArticleFolder;
window.renameArticleFolder = renameArticleFolder;
window.deleteArticleFolder = deleteArticleFolder;
window.selectArticleFolder = selectArticleFolder;
window.createArticle = createArticle;
window.deleteArticle = deleteArticle;
window.toggleArticleLock = toggleArticleLock;
window.openArticleReader = openArticleReader;
window.closeArticleReader = closeArticleReader;
window.saveArticle = saveArticle;
window.execEditor = execEditor;
window.setArticleFont = setArticleFont;
window.scrollToHeading = scrollToHeading;
window.updateTOC = updateTOC;

})();