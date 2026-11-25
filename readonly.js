/* ============================================================
   MAUVOISIN. — deployed site read-only guard
   Removes every write/edit control; browsing, focusing, filtering,
   audio and theme switching remain fully functional.
   ============================================================ */
(function () {
  'use strict';

  var WRITE_FNS = [
    'openUpload', 'openExport', 'openImport', 'doExportFullBundle', 'submitPrompt',
    'openItemEditor', 'saveItem', 'deleteItem', 'addTagToViewer', 'removeTagFromViewer',
    'handleAddSubImages', 'removeSubImage', 'toggleReorder', 'cycleItemSize',
    'deleteAudio', 'addBranch', 'renameBranch', 'deleteBranch',
    'addSheet', 'selectItemForSheet', 'handleSheetDirectUpload', 'confirmAddSheet',
    'tidyDesk', 'scatterDesk', 'saveDeskLayout', 'restoreDeskLayout',
    'openCreateSticky', 'openStickyEditor', 'saveSticky', 'toggleScribble',
    'setScribbleColor', 'setScribbleSize', 'clearScribble', 'deleteSheet',
    'toggleBind', 'openArchiveUpload', 'confirmArchiveUpload',
    'openSheetEditor', 'saveSheet', 'addArticleFolder', 'renameArticleFolder',
    'deleteArticleFolder', 'createArticle', 'deleteArticle', 'toggleArticleLock',
    'saveArticle', 'execEditor', 'setArticleFont', 'updateTOC'
  ];

  function noop() { return Promise.resolve(); }

  var BAD = [
    '.edit-chip', '.size-chip', '.viewer__edit', '.viewer__add-tag',
    '.admin-btn', '.about-branch__rename', '.articles-list__add',
    '.editor-toolbar', '.article-reader__btn', '.scribble-toggle',
    '#orderToggleBtn', '[contenteditable]'
  ].join(',');

  var queued = false;

  function purge() {
    queued = false;
    var nodes = document.querySelectorAll(BAD);
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();

    // keep only the focus button in the desk quick-bar
    document.querySelectorAll('.sheet__quick-bar').forEach(function (bar) {
      bar.querySelectorAll('button').forEach(function (b) {
        if (b.textContent.indexOf('聚焦') < 0) b.remove();
      });
    });

    var toolbar = document.getElementById('aboutDeskToolbar');
    if (toolbar && toolbar.style.display !== 'none') toolbar.style.display = 'none';
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(purge);
  }

  function init() {
    WRITE_FNS.forEach(function (n) {
      if (typeof window[n] === 'function') window[n] = noop;
    });
    purge();
    if (window.MutationObserver) {
      new MutationObserver(queue).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['contenteditable', 'onclick', 'class', 'style']
      });
    }
    setInterval(purge, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
