/* ============================================================
   MAUVOISIN. — READ-ONLY GUARD + VISUAL ARCHIVE / JOURNAL DESK
   ------------------------------------------------------------
   The public site never writes to the server. Everything in the
   About journal lives in this browser's localStorage only.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. kill every write / edit entry point ---------- */
  var WRITE_FNS = [
    'openUpload', 'openExport', 'openImport', 'doExportFullBundle', 'submitPrompt',
    'openItemEditor', 'saveItem', 'deleteItem', 'addTagToViewer', 'removeTagFromViewer',
    'handleAddSubImages', 'removeSubImage', 'toggleReorder', 'cycleItemSize',
    'deleteAudio', 'addBranch', 'renameBranch', 'deleteBranch', 'selectBranch',
    'addSheet', 'selectItemForSheet', 'handleSheetDirectUpload', 'confirmAddSheet',
    'tidyDesk', 'scatterDesk', 'saveDeskLayout', 'restoreDeskLayout',
    'openCreateSticky', 'openStickyEditor', 'saveSticky', 'toggleScribble',
    'setScribbleColor', 'setScribbleSize', 'clearScribble', 'deleteSheet',
    'openSheetEditor', 'saveSheet', 'addArticleFolder', 'renameArticleFolder',
    'deleteArticleFolder', 'selectArticleFolder', 'createArticle', 'deleteArticle',
    'toggleArticleLock', 'saveArticle', 'execEditor', 'setArticleFont', 'updateTOC'
  ];

  function noop() { return Promise.resolve(); }

  var BAD_SELECTOR = [
    '.edit-chip', '.size-chip', '.viewer__edit', '.viewer__add-tag',
    '.admin-btn', '.sheet__quick-bar', '.about-branch__rename',
    '.articles-list__add', '.editor-toolbar', '.article-reader__btn',
    '.scribble-toggle', '#orderToggleBtn', '[contenteditable]'
  ].join(',');

  var purgeQueued = false;
  function purge() {
    purgeQueued = false;
    var nodes = document.querySelectorAll(BAD_SELECTOR);
    var removed = false;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest && el.closest('.jrl-ui')) continue; // our journal is the only editable surface
      el.remove();
      removed = true;
    }
    if (removed) return;
  }
  function queuePurge() {
    if (purgeQueued) return;
    purgeQueued = true;
    requestAnimationFrame(purge);
  }

  function installGuard() {
    WRITE_FNS.forEach(function (name) {
      if (typeof window[name] === 'function') window[name] = noop;
    });
    document.addEventListener('keydown', function (e) {
      if (e.closest && e.closest('.jrl-ui')) return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        if (!t.closest('.jrl-ui') && e.key.length === 1) e.preventDefault();
      }
    }, true);
    purge();
    if (window.MutationObserver) {
      new MutationObserver(queuePurge).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['contenteditable', 'onclick', 'class']
      });
    }
    setInterval(purge, 1200); // safety net for late renders
  }

  /* ---------- 2. helpers ---------- */
  var KEY = 'mauvoisin_journal_v1';
  var state = { seeded: false, profiles: [], loose: [] };
  var activeProfile = null;
  var activePage = 0;
  var zTop = 100;

  function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg, true);
  }
  function blankPage(i) {
    return {
      title: 'PAGE ' + String(i || 1).padStart(2, '0'),
      text: 'Click here to write a note. This page is saved only in this browser.',
      note: 'Visual archive · reference material · do not redistribute.',
      images: []
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.profiles)) {
          state = {
            seeded: !!parsed.seeded,
            profiles: parsed.profiles,
            loose: Array.isArray(parsed.loose) ? parsed.loose : []
          };
        }
      }
    } catch (e) { /* corrupted local state — reseed */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('LOCAL STORAGE FULL — USE FEWER IMAGES'); }
  }

  function compress(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1400;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { cb(reader.result); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  function seedFromJSON() {
    fetch('data.json').then(function (r) { return r.json(); }).then(function (d) {
      var byId = {};
      (d.items || []).concat(d.aboutMedia || []).forEach(function (m) { byId[m.id] = m; });

      var profiles = (d.branches || []).map(function (b, bi) {
        var page = blankPage(1);
        page.title = b.name || 'CASE FILE';
        (d.sheets || []).filter(function (s) { return s.branchId === b.id; }).forEach(function (s, i) {
          var m = byId[s.itemId];
          if (m && m.src) {
            page.images.push({
              id: uid('pg'), src: m.src, title: m.title || '',
              x: 20 + (i * 96) % 260, y: 30 + (i * 74) % 180,
              rot: ((i % 2) ? 4 : -5), w: 190
            });
          }
        });
        return { id: b.id, name: b.name || 'CASE FILE ' + (bi + 1), created: b.created || Date.now(), pages: [page] };
      });

      var loose = (d.aboutMedia || []).map(function (m, i) {
        return {
          id: m.id, src: m.src, title: m.title || 'IMAGE',
          x: 430 + (i * 150) % 330, y: 130 + (i * 90) % 230,
          rot: i % 2 ? 6 : -5, w: 200, z: 100 + i
        };
      });

      if (!state.seeded) {
        state.profiles = profiles.length ? profiles : [{ id: uid('pf'), name: 'UNTITLED FILE', created: Date.now(), pages: [blankPage(1)] }];
        state.loose = loose;
        state.seeded = true;
        save();
      }
      renderAll();
    }).catch(function () {
      if (!state.profiles.length) {
        state.profiles = [{ id: uid('pf'), name: 'UNTITLED FILE', created: Date.now(), pages: [blankPage(1)] }];
        save();
      }
      renderAll();
    });
  }

  /* ---------- 3. desk rendering ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function renderProfiles() {
    var wrap = document.getElementById('jrlProfiles');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.profiles.forEach(function (p, i) {
      var item = el('div', 'jrl-profile' + (p.id === activeProfile ? ' is-active' : ''));
      item.dataset.cursorTitle = p.name;
      item.innerHTML =
        '<span class="jrl-profile__no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="jrl-profile__name">' + esc(p.name) + '</span>' +
        '<span class="jrl-profile__pg">' + p.pages.length + ' PG</span>';
      item.addEventListener('click', function () { openBook(p.id, 0); });
      wrap.appendChild(item);
    });
    var hint = document.getElementById('jrlHint');
    if (hint) hint.textContent = state.profiles.length ? 'SELECT A FILE TO OPEN ITS BOOK' : '+ NEW TO CREATE A FILE';
  }

  function draggable(node, obj, onClick) {
    var startX = 0, startY = 0, ox = 0, oy = 0, moved = false, active = false;
    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button,input')) return;
      active = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      ox = obj.x || 0; oy = obj.y || 0;
      obj.z = ++zTop;
      node.style.zIndex = obj.z;
      node.classList.add('is-dragging');
      try { node.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    node.addEventListener('pointermove', function (e) {
      if (!active) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      obj.x = ox + dx; obj.y = oy + dy;
      place(node, obj);
    });
    function end() {
      if (!active) return;
      active = false;
      node.classList.remove('is-dragging');
      save();
      if (!moved && onClick) onClick();
    }
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  function place(node, obj) {
    node.style.transform = 'translate(' + (obj.x || 0) + 'px,' + (obj.y || 0) + 'px) rotate(' + (obj.rot || 0) + 'deg)';
    node.style.zIndex = obj.z || 10;
    node.dataset.x = obj.x || 0;
    node.dataset.y = obj.y || 0;
  }

  // collage items are positioned with left/top inside the page, not transforms
  function draggableCollage(node, obj, onClick) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, active = false;
    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      active = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = obj.x || 0; oy = obj.y || 0;
      node.style.zIndex = ++zTop;
      node.classList.add('is-dragging');
      try { node.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    node.addEventListener('pointermove', function (e) {
      if (!active) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      obj.x = ox + dx; obj.y = oy + dy;
      node.style.left = obj.x + 'px';
      node.style.top = obj.y + 'px';
    });
    function end() {
      if (!active) return;
      active = false;
      node.classList.remove('is-dragging');
      save();
      if (!moved && onClick) onClick();
    }
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  function renderDesk() {
    var canvas = document.getElementById('jrlCanvas');
    if (!canvas) return;
    Array.prototype.slice.call(canvas.querySelectorAll('.jrl-object')).forEach(function (n) { n.remove(); });
    var empty = document.getElementById('jrlEmpty');
    if (empty) empty.style.display = (state.profiles.length || state.loose.length) ? 'none' : 'flex';

    state.profiles.forEach(function (p, i) {
      p.x = p.x != null ? p.x : 60 + (i % 3) * 245;
      p.y = p.y != null ? p.y : 80 + Math.floor(i / 3) * 190;
      p.rot = p.rot != null ? p.rot : (i % 2 ? 4 : -4);
      p.z = p.z || 100 + i;
      var book = el('div', 'jrl-object jrl-book');
      book.dataset.cursorTitle = p.name.toUpperCase();
      book.innerHTML =
        '<div class="jrl-book__shadow"></div>' +
        '<div class="jrl-book__stack"></div>' +
        '<div class="jrl-book__cover">' +
          '<div class="jrl-book__spine"></div>' +
          '<div class="jrl-book__eyebrow">VISUAL ARCHIVE</div>' +
          '<div class="jrl-book__title">' + esc(p.name) + '</div>' +
          '<div class="jrl-book__rule"></div>' +
          '<div class="jrl-book__meta">' + String(p.pages.length).padStart(2, '0') + ' PAGES · CASE FILE</div>' +
          '<div class="jrl-book__open">OPEN ↗</div>' +
        '</div>';
      place(book, p);
      draggable(book, p, function () { openBook(p.id, 0); });
      canvas.appendChild(book);
    });

    state.loose.forEach(function (m, i) {
      m.x = m.x != null ? m.x : 430 + (i % 3) * 170;
      m.y = m.y != null ? m.y : 120 + Math.floor(i / 3) * 200;
      m.rot = m.rot != null ? m.rot : (i % 2 ? 5 : -4);
      m.w = m.w || 200;
      m.z = m.z || 200 + i;
      var photo = el('div', 'jrl-object jrl-photo');
      photo.dataset.cursorTitle = m.title || 'IMAGE';
      photo.innerHTML =
        '<div class="jrl-photo__frame"><img src="' + esc(m.src) + '" alt="' + esc(m.title) + '" draggable="false"></div>' +
        '<div class="jrl-photo__cap">' + esc(m.title || 'UNTITLED') + '</div>';
      photo.style.width = m.w + 'px';
      place(photo, m);
      draggable(photo, m, function () { openLightbox(m.src, m.title); });
      canvas.appendChild(photo);
    });

    var count = document.getElementById('jrlCount');
    if (count) count.textContent = (state.profiles.length + state.loose.length) + ' OBJECTS';
    zTop = Math.max(zTop, 300 + state.profiles.length + state.loose.length);
  }

  function renderAll() { renderProfiles(); renderDesk(); }

  /* ---------- 4. journal overlay ---------- */
  function buildOverlay() {
    if (document.getElementById('jrlOverlay')) return;
    var ov = el('div', 'jrl-overlay jrl-ui');
    ov.id = 'jrlOverlay';
    ov.innerHTML =
      '<div class="jrl-bookview">' +
        '<div class="jrl-bookview__bar">' +
          '<span class="jrl-bookview__name" id="jrlBookName">CASE FILE</span>' +
          '<div class="jrl-bookview__tools">' +
            '<button class="jrl-mini" id="jrlAddPage">+ PAGE</button>' +
            '<button class="jrl-mini jrl-mini--close" id="jrlBookClose">CLOSE ×</button>' +
          '</div>' +
        '</div>' +
        '<div class="jrl-spread">' +
          '<div class="jrl-page jrl-page--left" id="jrlLeft"></div>' +
          '<div class="jrl-page jrl-page--right" id="jrlRight"></div>' +
          '<button class="jrl-turn jrl-turn--prev" id="jrlPrev" data-cursor-title="PREV">‹</button>' +
          '<button class="jrl-turn jrl-turn--next" id="jrlNext" data-cursor-title="NEXT">›</button>' +
        '</div>' +
        '<div class="jrl-bookview__foot">' +
          '<span id="jrlPageInfo">PAGE 01 / 01</span>' +
          '<span>CLICK ANY TEXT TO WRITE · SAVED IN THIS BROWSER ONLY</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    document.getElementById('jrlBookClose').addEventListener('click', closeBook);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeBook(); });
    document.getElementById('jrlPrev').addEventListener('click', function () { turn(-1); });
    document.getElementById('jrlNext').addEventListener('click', function () { turn(1); });
    document.getElementById('jrlAddPage').addEventListener('click', function () {
      var p = getProfile();
      if (!p) return;
      p.pages.push(blankPage(p.pages.length + 1));
      save(); renderPage(); renderProfiles(); renderDesk();
    });
    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('jrlOverlay').classList.contains('is-open')) return;
      if (e.key === 'Escape') closeBook();
      if (e.key === 'ArrowLeft') turn(-1);
      if (e.key === 'ArrowRight') turn(1);
    });
  }

  function getProfile() {
    return state.profiles.find(function (p) { return p.id === activeProfile; }) || null;
  }
  function getCurrentPage() {
    var p = getProfile();
    if (!p) return null;
    if (!p.pages.length) p.pages.push(blankPage(1));
    activePage = Math.max(0, Math.min(activePage, p.pages.length - 1));
    return p.pages[activePage];
  }
  function openBook(id, page) {
    buildOverlay();
    activeProfile = id;
    activePage = page || 0;
    document.getElementById('jrlOverlay').classList.add('is-open');
    document.body.classList.add('modal-open');
    renderPage();
    renderProfiles();
  }
  function closeBook() {
    var ov = document.getElementById('jrlOverlay');
    if (ov) ov.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }
  function turn(dir) {
    var p = getProfile();
    if (!p || !p.pages.length) return;
    activePage = (activePage + dir + p.pages.length) % p.pages.length;
    renderPage();
  }

  function bindEditable(node, page, field) {
    node.addEventListener('input', function () {
      page[field] = node.innerText;
      save();
    });
    node.addEventListener('blur', function () { save(); });
  }

  function renderPage() {
    var p = getProfile(), page = getCurrentPage();
    if (!p || !page) return;
    document.getElementById('jrlBookName').textContent = p.name.toUpperCase();
    document.getElementById('jrlPageInfo').textContent =
      'PAGE ' + String(activePage + 1).padStart(2, '0') + ' / ' + String(p.pages.length).padStart(2, '0');

    var left = document.getElementById('jrlLeft');
    left.innerHTML =
      '<div class="jrl-paper__grain"></div>' +
      '<div class="jrl-script">KYOOSANG’S VISUAL ARCHIVE</div>' +
      '<div class="jrl-stamp">MAUVOISIN<br><span>CASE FILE</span><br>No. ' + esc(String(p.id).slice(-4).toUpperCase()) + '</div>' +
      '<div class="jrl-divider"></div>' +
      '<div class="jrl-page__eyebrow">FILE / ' + esc(p.name.toUpperCase()) + '</div>' +
      '<h2 class="jrl-page__title jrl-edit" data-cursor-title="TITLE" contenteditable="true">' + esc(page.title || 'UNTITLED') + '</h2>' +
      '<div class="jrl-page__copy jrl-edit" data-cursor-title="WRITE" contenteditable="true">' + esc(page.text || '') + '</div>' +
      '<div class="jrl-page__sign">— VISUAL ARCHIVE, MAUVOISIN.</div>';
    bindEditable(left.querySelector('[contenteditable]'), page, 'title');
    bindEditable(left.querySelectorAll('[contenteditable]')[1], page, 'text');

    var right = document.getElementById('jrlRight');
    right.innerHTML =
      '<div class="jrl-paper__grain"></div>' +
      '<div class="jrl-collage" id="jrlCollage"></div>' +
      '<div class="jrl-right-note jrl-edit" data-cursor-title="WRITE" contenteditable="true">' + esc(page.note || '') + '</div>' +
      '<button class="jrl-page__upload jrl-mini" id="jrlPageUpload">+ ADD IMAGE</button>' +
      '<input type="file" id="jrlPageInput" accept="image/*" multiple hidden>';
    bindEditable(right.querySelector('.jrl-edit'), page, 'note');

    renderCollage(page);
    document.getElementById('jrlPageUpload').addEventListener('click', function () {
      document.getElementById('jrlPageInput').click();
    });
    document.getElementById('jrlPageInput').addEventListener('change', function (e) {
      Array.prototype.slice.call(e.target.files || []).forEach(function (f, i) {
        if (!/^image\//.test(f.type)) return;
        compress(f, function (src) {
          if (!src) return;
          page.images.push({
            id: uid('pg'), src: src, title: f.name,
            x: 26 + (i * 88) % 230, y: 24 + (i * 70) % 190,
            rot: i % 2 ? 5 : -4, w: 180
          });
          save(); renderCollage(page);
        });
      });
      e.target.value = '';
    });
  }

  function renderCollage(page) {
    var box = document.getElementById('jrlCollage');
    if (!box) return;
    box.innerHTML = '';
    (page.images || []).forEach(function (im, i) {
      var card = el('div', 'jrl-collage__item');
      card.innerHTML = '<img src="' + esc(im.src) + '" alt="' + esc(im.title) + '" draggable="false">' +
                       '<span class="jrl-collage__cap">' + esc(im.title || 'FIG. ' + (i + 1)) + '</span>';
      card.style.width = (im.w || 180) + 'px';
      card.style.left = (im.x || 20) + 'px';
      card.style.top = (im.y || 20) + 'px';
      card.style.transform = 'rotate(' + (im.rot || 0) + 'deg)';
      card.style.zIndex = i + 1;
      draggableCollage(card, im, function () { openLightbox(im.src, im.title); });
      box.appendChild(card);
    });
  }

  /* ---------- 5. loose image lightbox ---------- */
  function openLightbox(src, title) {
    var lb = document.getElementById('jrlLightbox');
    if (!lb) {
      lb = el('div', 'jrl-overlay jrl-ui');
      lb.id = 'jrlLightbox';
      lb.innerHTML = '<figure class="jrl-lightbox"><img id="jrlLightboxImg" alt=""><figcaption id="jrlLightboxCap"></figcaption></figure>';
      document.body.appendChild(lb);
      lb.addEventListener('click', function () { lb.classList.remove('is-open'); });
    }
    document.getElementById('jrlLightboxImg').src = src;
    document.getElementById('jrlLightboxCap').textContent = title || 'IMAGE';
    lb.classList.add('is-open');
  }

  /* ---------- 6. wire up ---------- */
  function bindControls() {
    var looseInput = document.getElementById('jrlLooseInput');
    document.getElementById('jrlUploadLoose').addEventListener('click', function () { looseInput.click(); });
    looseInput.addEventListener('change', function (e) {
      Array.prototype.slice.call(e.target.files || []).forEach(function (f, i) {
        if (!/^image\//.test(f.type)) return;
        compress(f, function (src) {
          if (!src) return;
          state.loose.push({
            id: uid('loose'), src: src, title: f.name,
            x: 400 + (i * 140) % 360, y: 120 + (i * 90) % 260,
            rot: i % 2 ? 6 : -5, w: 200, z: ++zTop
          });
          save(); renderDesk();
        });
      });
      e.target.value = '';
    });

    document.getElementById('jrlNewProfile').addEventListener('click', function () {
      var name = window.prompt('CHARACTER FILE NAME');
      if (!name || !name.trim()) return;
      name = name.trim().slice(0, 40);
      state.profiles.push({
        id: uid('pf'), name: name, created: Date.now(),
        pages: [blankPage(1)], x: 60 + (state.profiles.length % 3) * 245,
        y: 80 + Math.floor(state.profiles.length / 3) * 190, z: ++zTop
      });
      save(); renderAll(); toast('FILE CREATED');
    });
  }

  function applyHash() {
    var h = (window.location.hash || '').replace('#', '').toLowerCase();
    if (['projects', 'about', 'articles'].indexOf(h) >= 0 && typeof window.switchView === 'function') {
      window.switchView(h);
    }
  }

  installGuard();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindControls(); load(); seedFromJSON(); applyHash();
    });
  } else {
    bindControls(); load(); seedFromJSON(); applyHash();
  }
})();
