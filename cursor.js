/* ============================================================
   MAUVOISIN. — slow, low-FPS cursor
   Always on the topmost page layer (pointer-events: none).
   Hardware pointer only; the native cursor is hidden by CSS.
   ============================================================ */
(function () {
  'use strict';

  var FPS = 13;                       // low frame-rate texture
  var TICK = Math.round(1000 / FPS);  // ~77ms per visual update
  var EASE = 0.085;                   // lazy trailing delay

  var mx = window.innerWidth / 2,
      my = window.innerHeight / 2,
      rx = mx,
      ry = my,
      cursorEl = null,
      infoEl = null,
      moved = false;

  function refresh() {
    cursorEl = document.getElementById('cursor');
    infoEl = document.getElementById('cursorInfo');
    if (cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  function onMove(e) {
    mx = e.clientX;
    my = e.clientY;
    moved = true;
    if (!cursorEl) refresh();
    if (cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  document.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', function () {
    if (cursorEl) cursorEl.classList.add('is-hidden');
  });
  document.addEventListener('mouseenter', function () {
    if (cursorEl) cursorEl.classList.remove('is-hidden');
  });

  function frame() {
    // The dot/ring lag behind the real pointer; the info tag follows faster.
    rx += (mx - rx) * EASE;
    ry += (my - ry) * EASE;
    if (cursorEl) {
      cursorEl.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
    }
    if (infoEl) {
      infoEl.style.transform = 'translate3d(' + (mx + 18).toFixed(2) + 'px,' + (my + 18).toFixed(2) + 'px,0)';
    }
    if (moved && cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      refresh();
      rx = mx; ry = my;
      frame();
      setInterval(frame, TICK);
    });
  } else {
    refresh();
    rx = mx; ry = my;
    frame();
    setInterval(frame, TICK);
  }
})();
