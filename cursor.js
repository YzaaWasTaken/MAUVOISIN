/* ============================================================
   MAUVOISIN. — two-speed cursor
   Inner dot: 1:1 with the pointer, zero delay.
   Outer ring: slight ease-out lag — fast catch-up, soft settle.
   Always topmost, pointer-events: none.
   ============================================================ */
(function () {
  'use strict';

  var RING_MS = 150;  // crisp, barely-there lag

  function easeOut(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  var px = window.innerWidth / 2, py = window.innerHeight / 2;
  var rx = px, ry = py;                 // ring rendered position
  var fromX = px, fromY = py, startTime = 0;
  var cursorEl = null, ringEl = null, infoEl = null, moved = false;

  function refresh() {
    cursorEl = document.getElementById('cursor');
    ringEl = cursorEl ? cursorEl.querySelector('.cursor__ring') : null;
    infoEl = document.getElementById('cursorInfo');
    if (cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  function onMove(e) {
    px = e.clientX;
    py = e.clientY;
    moved = true;

    // restart the ring's ease from wherever it currently is
    fromX = rx; fromY = ry;
    startTime = performance.now();

    if (!cursorEl) refresh();
    if (cursorEl) {
      cursorEl.classList.add('is-ready');
      cursorEl.classList.remove('is-hidden');
    }
  }

  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', function () {
    if (cursorEl) cursorEl.classList.add('is-hidden');
  });
  document.addEventListener('mouseenter', function () {
    if (cursorEl) cursorEl.classList.remove('is-hidden');
  });

  function frame(now) {
    var t = Math.min(1, (now - startTime) / RING_MS);
    var k = easeOut(t);
    rx = fromX + (px - fromX) * k;
    ry = fromY + (py - fromY) * k;

    // container sits exactly on the pointer → inner dot is 1:1
    if (cursorEl) {
      cursorEl.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';
    }
    // ring is offset inside the container by its own lag
    if (ringEl) {
      var dx = rx - px, dy = ry - py;
      ringEl.style.transform = 'translate(calc(-50% + ' + dx.toFixed(2) + 'px), calc(-50% + ' + dy.toFixed(2) + 'px))';
    }
    if (infoEl) {
      infoEl.style.transform = 'translate3d(' + (px + 18).toFixed(2) + 'px,' + (py + 18).toFixed(2) + 'px,0)';
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
      startTime = performance.now();
      requestAnimationFrame(frame);
    });
  } else {
    refresh();
    startTime = performance.now();
    requestAnimationFrame(frame);
  }
})();
