/* ============================================================
   MAUVOISIN — 界面音效（Web Audio 合成，零外部资源）
   键盘音：高频瞬态 + 低频 thock（机械键盘质感）
   纸张音：粉噪带通扫频（翻书页质感）+ 低通柔化
   同时供编辑版 app.js 与部署版 deploy.js 使用。
   ============================================================ */
(function(global){
  'use strict';

  var MUTE_KEY = 'mau_sfx_muted';
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch(e){}

  var ctx = null, pinkBuf = null, whiteBuf = null;

  function ac(){
    if(!ctx){
      var AC = global.AudioContext || global.webkitAudioContext;
      if(!AC) return null;
      try { ctx = new AC(); } catch(e){ return null; }
    }
    if(ctx.state === 'suspended'){ try { ctx.resume(); } catch(e){} }
    return ctx;
  }

  // 预生成 1.2s 噪声缓冲并复用，避免每次点击都分配
  function makeNoise(c, pink){
    var len = Math.max(1, Math.floor(c.sampleRate * 1.2));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    if(pink){
      // Paul Kellet 粉噪近似：比白噪柔和，接近纸张摩擦的低频重心
      var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for(var i=0;i<len;i++){
        var w = Math.random()*2 - 1;
        b0 =  0.99886*b0 + w*0.0555179;
        b1 =  0.99332*b1 + w*0.0750759;
        b2 =  0.96900*b2 + w*0.1538520;
        b3 =  0.86650*b3 + w*0.3104856;
        b4 =  0.55000*b4 + w*0.5329522;
        b5 = -0.7616 *b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.16;
        b6 = w*0.115926;
      }
    } else {
      for(var j=0;j<len;j++) d[j] = Math.random()*2 - 1;
    }
    return buf;
  }
  function pinkBufOf(c){ if(!pinkBuf) pinkBuf = makeNoise(c, true);  return pinkBuf; }
  function whiteBufOf(c){ if(!whiteBuf) whiteBuf = makeNoise(c, false); return whiteBuf; }

  // 纸张沙沙：粉噪 → 带通扫频 → 揉捏包络 → 低通柔化
  function swish(opts){
    if(muted) return;
    var c = ac(); if(!c) return;
    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.22;
    var src = c.createBufferSource();
    src.buffer = opts.white ? whiteBufOf(c) : pinkBufOf(c);
    src.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = opts.q || 0.7;
    var f = opts.freqs || [700, 2400, 1100];
    bp.frequency.setValueAtTime(f[0], t0);
    bp.frequency.exponentialRampToValueAtTime(f[1], t0 + dur*0.42);
    bp.frequency.exponentialRampToValueAtTime(f[2], t0 + dur);
    var g = c.createGain();
    var peak = opts.gain || 0.05;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + dur*(opts.attack || 0.16));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lp || 3600;
    src.connect(bp); bp.connect(g); g.connect(lp); lp.connect(c.destination);
    src.start(t0, Math.random()*0.5);
    src.stop(t0 + dur + 0.03);
  }

  // 短促实体音：用于键盘的 thock / 纸页的低频托底
  function hit(freq, dur, opts){
    if(muted) return;
    var c = ac(); if(!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if(opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain || 0.05, t0 + (opts.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = opts.lp || 2600;
    o.connect(g); g.connect(lp); lp.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // 键盘瞬态：极短高通噪声脉冲（"咔"的塑料碰撞感）
  function clickTransient(level){
    if(muted) return;
    var c = ac(); if(!c) return;
    var t0 = c.currentTime;
    var s = c.createBufferSource(); s.buffer = whiteBufOf(c);
    var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2100;
    var g = c.createGain();
    g.gain.setValueAtTime(level || 0.075, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);
    s.connect(hp); hp.connect(g); g.connect(c.destination);
    s.start(t0, Math.random()*0.5); s.stop(t0 + 0.03);
  }

  var SFX = {
    unlock: function(){ ac(); },

    // 按键：机械键盘 —— 高频瞬态 + 低频 thock + 中频机械感，每次音高轻微随机
    click: function(){
      var v = 0.93 + Math.random()*0.14;
      clickTransient(0.07);
      hit(205*v, 0.055, {type:'triangle', gain:0.07, slide:150*v, lp:1300});
      hit(430*v, 0.028, {type:'sine', gain:0.02, delay:0.004, lp:1900});
    },

    // 切换视图：柔和翻页 + 轻低频气流（稍延后，让点击键盘音先响）
    view: function(){
      swish({pink:true, dur:0.3, freqs:[460, 1500, 780], q:0.6, gain:0.075, attack:0.2, lp:3000, delay:0.015});
      hit(140, 0.16, {type:'sine', gain:0.03, slide:100, lp:520, delay:0.015});
    },

    // 拿起图片：书页翻动（中等厚度）
    pickImage: function(){
      swish({pink:true, dur:0.24, freqs:[520, 1800, 900], q:0.75, gain:0.085, attack:0.14, lp:3600});
      hit(190, 0.07, {type:'sine', gain:0.025, slide:140, lp:600});
    },

    // 拿起档案（较厚）：更低沉、更久的书页翻动
    pickArchive: function(){
      swish({pink:true, dur:0.31, freqs:[400, 1300, 650], q:0.6, gain:0.095, attack:0.18, lp:3000});
      hit(135, 0.12, {type:'triangle', gain:0.038, slide:92, lp:540});
    },

    // 拿起便利贴（薄）：轻快、偏高、短促的纸片滑动
    pickSticky: function(){
      swish({pink:true, dur:0.16, freqs:[900, 2600, 1300], q:0.9, gain:0.075, attack:0.1, lp:4200});
    },

    // 放下：纸张落桌的短闷响
    drop: function(){
      swish({pink:true, dur:0.13, freqs:[700, 300, 200], q:0.8, gain:0.055, attack:0.05, lp:1800});
      hit(120, 0.06, {type:'sine', gain:0.026, slide:85, lp:440});
    },

    // 根据纸张类型自动选择翻页音
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

  // 全局点击委托：可点击元素统一播放键盘音，视图导航由 switchView 播放翻页音
  function bindClickDelegates(){
    document.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.closest) return;
      if(t.closest('.sheet')) return;                 // 纸张有自己的翻页音
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
