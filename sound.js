/* ============================================================
   MAUVOISIN — 界面音效（Web Audio 合成，零外部资源）
   点击：Lips Pop 啵声 / Bubbly 气泡 —— 频率扫频瞬态，清脆圆润
   视图 / 打开图片：Sonar Pluck 声呐拨弦 —— 基频+泛音指数衰减 + 空灵回声
   纸张：粉噪带通扫频（翻书页质感），保留上版书页音
   同时供编辑版 app.js 与部署版 deploy.js 使用。
   ============================================================ */
(function(global){
  'use strict';

  var MUTE_KEY = 'mau_sfx_muted';
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch(e){}

  // 音效暂定关闭：保留全部合成代码与接入点，待用户提供音频文件后改为播放文件即可
  var ENABLED = false;

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

  /* ---------- Lips Pop / Bubbly：清脆的"啵"声与气泡声 ----------
     原理：正弦振荡器做快速频率扫频（pop 高→低，bubble 低→高），
     叠加极短带通噪声瞬态增加"啵"的清晰度。时值 50~90ms。 */
  function pop(opts){
    if(!ENABLED || muted) return;
    var c = ac(); if(!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var v = opts.v || (0.92 + Math.random()*0.16);
    var base = (opts.freq || 760) * v;
    var up = !!opts.up;                       // bubble 上扫 / pop 下扫
    var f0 = base * (up ? 0.55 : 1.75);
    var f1 = base * (up ? 1.65 : 0.40);
    var dur = opts.dur || 0.075;

    var o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur*0.82);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain || 0.16, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);

    // 极短瞬态：一点点带通白噪，做出嘴唇/气泡破裂的清晰感
    if(opts.transient !== false){
      var s = c.createBufferSource(); s.buffer = whiteBufOf(c);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = opts.bp || 2100; bp.Q.value = 1.1;
      var tg = c.createGain();
      tg.gain.setValueAtTime(opts.tgain || 0.028, t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.011);
      s.connect(bp); bp.connect(tg); tg.connect(c.destination);
      s.start(t0, Math.random()*0.5); s.stop(t0 + 0.02);
    }
  }

  /* ---------- Sonar Pluck：空灵高级的声呐拨弦 ----------
     原理：基频 + 2/3 次泛音，正弦波指数衰减（越快的高频衰减越快），
     经高通去掉浑浊低频，再送短延迟反馈营造空间回声。 */
  function pluck(freq, opts){
    if(!ENABLED || muted) return;
    var c = ac(); if(!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.55;
    var peak = opts.gain || 0.1;

    var hp = c.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = opts.hp || 320;
    hp.connect(c.destination);

    // 空灵回声：短延迟 + 小反馈，反馈在尾音内衰减到静音避免节点残留
    if(opts.echo !== false){
      var dl = c.createDelay(1.0); dl.delayTime.value = opts.echoTime || 0.17;
      var fb = c.createGain();
      fb.gain.setValueAtTime(opts.echoFb || 0.26, t0);
      fb.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 1.1);
      var wet = c.createGain(); wet.gain.value = opts.echoGain || 0.3;
      hp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(c.destination);
    }

    var partials = opts.partials || [[1, 1], [2, 0.3], [3, 0.12]];
    partials.forEach(function(p, idx){
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * p[0] * (1 + (Math.random()-0.5)*0.006);
      var amp = peak * p[1];
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (1 - idx*0.16));
      o.connect(g); g.connect(hp);
      o.start(t0); o.stop(t0 + dur + 0.05);
    });
  }

  // 纸张沙沙：粉噪 → 带通扫频 → 揉捏包络 → 低通柔化（书页音，保留）
  function swish(opts){
    if(!ENABLED || muted) return;
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

  // 低频托底：纸页落桌等
  function hit(freq, dur, opts){
    if(!ENABLED || muted) return;
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

  var SFX = {
    unlock: function(){ if(ENABLED) ac(); },

    // 各类点击：Lips Pop 啵声 —— 清脆圆润，音高每次轻微随机
    click: function(){
      var v = 0.9 + Math.random()*0.2;
      pop({freq: 780*v, gain: 0.17, dur: 0.07, bp: 2200*v, tgain: 0.03});
    },

    // 切换视图：Sonar Pluck 拨弦（E5）+ 轻气泡，空灵高级
    view: function(){
      pop({freq: 620, up: true, gain: 0.09, dur: 0.06, tgain: 0.012, delay: 0.005});
      pluck(659.25, {dur: 0.62, gain: 0.085, echoTime: 0.17, echoFb: 0.3, delay: 0.012});
    },

    // 点击 project 图片：更清亮的 Sonar Pluck（A5）—— 空灵 ping
    openImage: function(){
      pop({freq: 900, up: true, gain: 0.07, dur: 0.055, tgain: 0.012});
      pluck(880, {dur: 0.5, gain: 0.1, echoTime: 0.14, echoFb: 0.24, echoGain: 0.26});
    },

    // 拿起图片：书页翻动（中等厚度）
    pickImage: function(){
      swish({pink:true, dur:0.24, freqs:[620, 2000, 1050], q:0.75, gain:0.085, attack:0.14, lp:3800});
      hit(190, 0.07, {type:'sine', gain:0.022, slide:140, lp:600});
    },

    // 拿起档案（较厚）：更低沉、更久的书页翻动
    pickArchive: function(){
      swish({pink:true, dur:0.31, freqs:[480, 1500, 760], q:0.6, gain:0.095, attack:0.18, lp:3200});
      hit(135, 0.12, {type:'triangle', gain:0.034, slide:92, lp:540});
    },

    // 拿起便利贴（薄）：轻快、偏高、短促的纸片滑动
    pickSticky: function(){
      swish({pink:true, dur:0.16, freqs:[1000, 2800, 1450], q:0.9, gain:0.075, attack:0.1, lp:4400});
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
    get muted(){ return muted; },
    get enabled(){ return ENABLED; }
  };

  // 注入静态样式与静音开关按钮（不依赖 style.css 改动）
  function injectUI(){
    if(!ENABLED) return;  // 音效关闭时不显示开关，代码保留待启用
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

  // 全局点击委托：可点击元素统一播放啵声；project 图片拨弦；导航由 switchView 播放拨弦
  function bindClickDelegates(){
    document.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.closest) return;
      if(t.closest('.sheet')) return;                       // 纸张有自己的翻页音
      if(t.closest('.gallery__item')){ SFX.openImage(); return; }  // 点击 project 图片
      if(t.closest('.viewer__nav')){ SFX.openImage(); return; }    // 查看器翻页同款拨弦
      if(t.closest('.header__nav-item')) return;            // 视图切换音由 switchView 播放
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
    var unlock = function(){ SFX.unlock(); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.SFX = SFX;
})(window);
