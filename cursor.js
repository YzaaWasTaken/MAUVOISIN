/* ============================================================
   MAUVOISIN. — silky trailing cursor
   Fast catch-up, slow settle (ease-out) on every pointer move.
   Always the topmost page layer; pointer-events: none.
   ============================================================ */
(function () {
  'use strict';

  var FOLLOW_MS = 560;   // cursor catch-up duration
  var INFO_MS = 300;     // label follows a little quicker

  // easeOutExpo: big movement first, then a long soft tail
  function easeOut(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -9 * t);
  }

  var px = window.innerWidth / 2, py = window.innerHeight / 2;
  var cx = px, cy = py;      // rendered cursor position
  var ix = px, iy = py;      // rendered label position
  var fromCX = px, fromCY = py, toX = px, toY = py, startC = 0;
  var fromIX = px, fromIY = py, startI = 0;
  var cursorEl = null, infoEl = null, moved = false;

  function refresh() {
    cursorEl = document.getElementById('cursor');
    infoEl = document.getElementById('cursorInfo');
    if (cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  function onMove(e) {
    var now = performance.now();
    toX = e.clientX;
    toY = e.clientY;
    moved = true;

    // restart from the current rendered position: no teleport, no jitter
    fromCX = cx; fromCY = cy;
    fromIX = ix; fromIY = iy;
    startC = now;
    startI = now;

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

  function frame(now) {
    var tc = Math.min(1, (now - startC) / FOLLOW_MS);
    var ti = Math.min(1, (now - startI) / INFO_MS);
    var ec = easeOut(tc), ei = easeOut(ti);

    cx = fromCX + (toX - fromCX) * ec;
    cy = fromCY + (toY - fromCY) * ec;
    ix = fromIX + (toX - fromIX) * ei;
    iy = fromIY + (toY - fromIY) * ei;

    if (cursorEl) {
      cursorEl.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
    }
    if (infoEl) {
      infoEl.style.transform = 'translate3d(' + (ix + 18).toFixed(2) + 'px,' + (iy + 18).toFixed(2) + 'px,0)';
    }
    if (moved && cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      refresh();
      startC = startI = performance.now();
      requestAnimationFrame(frame);
    });
  } else {
    refresh();
    startC = startI = performance.now();
    requestAnimationFrame(frame);
  }
})();
