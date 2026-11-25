/* ============================================================
   MAUVOISIN — 界面音效（Web Audio 合成，零外部资源）
   同时供编辑版 app.js 与部署版 deploy.js 使用。
   ============================================================ */
(function(global){
  'use strict';

  var MUTE_KEY = 'mau_sfx_muted';
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch(e){}

  var ctx = null;
  function ac(){
    if(!ctx){
      var AC = global.AudioContext || global.webkitAudioContext;
      if(!AC) return null;
      try { ctx = new AC(); } catch(e){ return null; }
    }
    if(ctx.state === 'suspended'){ try { ctx.resume(); } catch(e){} }
    return ctx;
  }

  function env(g, t0, peak, dur, attack){
    attack = attack || 0.005;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone(freq, dur, opts){
    if(muted) return;
    var c = ac(); if(!c) return;
    opts = opts || {};
    var t0 = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if(opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    env(g.gain, t0, opts.gain || 0.05, dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  function noise(dur, opts){
    if(muted) return;
    var c = ac(); if(!c) return;
    opts = opts || {};
    var t0 = c.currentTime;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for(var i=0;i<len;i++) d[i] = Math.random()*2 - 1;
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 1200, t0);
    if(opts.slide) f.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    f.Q.value = opts.q || 0.8;
    var g = c.createGain();
    env(g.gain, t0, opts.gain || 0.04, dur, 0.004);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  var SFX = {
    unlock: function(){ ac(); },
    // 通用点击：短促清脆
    click: function(){ tone(920, 0.055, {type:'triangle', gain:0.03, slide:620}); },
    // 切换 PROJECTS / ABOUT / ARTICLES：柔和上扬滑音 + 轻气声
    view: function(){
      tone(430, 0.17, {type:'sine', gain:0.05, slide:760});
      noise(0.13, {freq:900, slide:1900, gain:0.018});
    },
    // 拿起图片：纸张摩擦（中频噪声）+ 低频托底
    pickImage: function(){
      noise(0.17, {freq:620, slide:1500, q:0.7, gain:0.045});
      tone(250, 0.12, {type:'sine', gain:0.03});
    },
    // 拿起档案（较厚）：更沉的翻动声
    pickArchive: function(){
      noise(0.22, {freq:360, slide:900, q:0.6, gain:0.055});
      tone(165, 0.18, {type:'triangle', gain:0.035});
    },
    // 拿起便利贴：更轻更亮的粘贴声
    pickSticky: function(){
      noise(0.12, {freq:1900, slide:720, q:1.1, gain:0.038});
      tone(1180, 0.07, {type:'sine', gain:0.025});
    },
    // 放下：闷响
    drop: function(){ noise(0.12, {freq:820, slide:280, gain:0.028}); },
    // 根据纸张类型自动选择拿起音效
    pickSheet: function(sheet){
      if(!sheet) return SFX.pickImage();
      if(sheet.isSticky) return SFX.pickSticky();
      if(sheet.isArchive) return SFX.pickArchive();
      return SFX.pickImage();
    },
    toggleMute: function(){
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch(e){}
      if(!muted) SFX.click();
      return muted;
    },
    get muted(){ return muted; }
  };

  // 注入静态样式与静音开关按钮（不依赖 style.css 改动）
  function injectUI(){
    if(!document.getElementById('mau-sfx-style')){
      var st = document.createElement('style');
      st.id = 'mau-sfx-style';
      st.textContent =
        '#sfxBtn{cursor:pointer}' +
        '#sfxBtn.is-off .header__toggle-dot{opacity:.3}' +
        '@media(max-width:768px){#sfxBtn span{display:none}}';
      document.head.appendChild(st);
    }
    if(document.getElementById('sfxBtn')) return;
    var meta = document.querySelector('.header__meta');
    if(!meta) return;
    var b = document.createElement('div');
    b.className = 'header__toggle' + (muted ? ' is-off' : '');
    b.id = 'sfxBtn';
    b.setAttribute('data-cursor-title', 'SOUND');
    b.innerHTML = '<div class="header__toggle-dot"></div><span id="sfxLabel">' + (muted ? 'OFF' : 'ON') + '</span>';
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var m = SFX.toggleMute();
      var lab = document.getElementById('sfxLabel');
      if(lab) lab.textContent = m ? 'OFF' : 'ON';
      b.classList.toggle('is-off', m);
    });
    meta.appendChild(b);
  }

  // 全局点击委托：可点击元素统一播放 click 音，视图导航由 switchView 单独处理
  function bindClickDelegates(){
    document.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.closest) return;
      if(t.closest('.sheet')) return;                 // 纸张有自己的拿起/聚焦音
      if(t.closest('.header__nav-item')) return;      // 视图切换音由 switchView 播放
      if(t.closest('#sfxBtn')) return;
      if(t.closest('button, a, [onclick], .header__logo, .header__toggle, ' +
                   '.about-branch, .articles-folder, .folder-chip, .filter-tag, .gallery__filter-item')){
        SFX.click();
      }
    }, true);
  }

  function init(){
    injectUI();
    bindClickDelegates();
    // 首次交互解锁 AudioContext（浏览器自动播放策略）
    var unlock = function(){ SFX.unlock(); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.SFX = SFX;
})(window);
