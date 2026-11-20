// Lucy's Light / Sunset / Dark switch, used here to preview a time of day in the globe.
// CSS eases the colours and slides the knob. This picks the mood, adds the squash and
// plays a small sound. Sounds are made live with the Web Audio API, so there are no files.
// The globe listens for the "globe:pick" event and can move the knob with window.globeSwitch.

var SOUND_CHOICE = {
  light: 'chime',     // chime, bell, musicbox, tick
  sunset: 'hum',      // swell, hum, windchime, tick
  dark: 'deepbell',   // pings, deepbell, twinkle, tick
  slide: 'none'       // whoosh, tick, none
};

(function () {
  var root = document.documentElement;
  var toggle = document.querySelector('.toggle');
  var face = toggle.querySelector('.toggle__face');
  var stops = Array.prototype.slice.call(toggle.querySelectorAll('.toggle__stop'));
  var moods = stops.map(function (s) { return s.dataset.mood; });
  var soundButton = document.getElementById('soundBtn');
  var soundLabel = soundButton.querySelector('.sound__label');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SOUND_KEY = 'lucy-theme-sound';

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  /* ---------- Sound building blocks ---------- */

  var ctx = null;
  var master = null;

  // Browsers only allow audio after a tap, click or key press, so this runs on the first one
  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  // Phones need two extra steps before Web Audio is heard (see the original switch).
  var silentLoop = null;
  var unlocked = false;

  function silentWav() {
    var samples = 800;
    var buffer = new ArrayBuffer(44 + samples);
    var view = new DataView(buffer);
    function text(at, s) { for (var i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); }
    text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    text(36, 'data'); view.setUint32(40, samples, true);
    for (var i = 0; i < samples; i++) view.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  function unlock() {
    if (unlocked || !soundOn) return;
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!navigator.audioSession) {
      silentLoop = new Audio(silentWav());
      silentLoop.loop = true;
      silentLoop.setAttribute('playsinline', '');
      silentLoop.volume = 0.01;
      var p = silentLoop.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!audio()) return;
    var src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  ['pointerdown', 'touchend', 'keydown'].forEach(function (type) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (!silentLoop) return;
    if (document.hidden) silentLoop.pause();
    else if (soundOn) { var p = silentLoop.play(); if (p && p.catch) p.catch(function () {}); }
  });

  // One note: a quick fade in, then a fade out
  function tone(freq, at, length, opts) {
    opts = opts || {};
    var t = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(freq * opts.glide, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.level || 0.08, t + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(opts.into || master);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  // A bell: a few overtones that fade at different speeds
  function bell(freq, at, length, level) {
    [[1, 1], [2.01, 0.45], [3.02, 0.22], [4.17, 0.12]].forEach(function (p) {
      tone(freq * p[0], at, length / p[0] * 1.6, { level: level * p[1], attack: 0.005 });
    });
  }

  // Filtered noise, for breathy sounds
  function noise(at, length, from, to, level) {
    var t = ctx.currentTime + at;
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + length * 0.6);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
  }

  // A soft lowpass that opens and closes, for warm pads
  function warmFilter(open, length) {
    var t = ctx.currentTime;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, t);
    filter.frequency.exponentialRampToValueAtTime(open, t + length * 0.4);
    filter.frequency.exponentialRampToValueAtTime(500, t + length);
    filter.connect(master);
    return filter;
  }

  function tick(at, freq) {
    tone(freq || 2400, at, 0.06, { type: 'triangle', level: 0.05, attack: 0.002 });
  }

  /* ---------- Sound library ---------- */

  var SOUND_LIBRARY = {
    light: {
      chime: { name: 'Rising chime', play: function () {
        [1046.5, 1318.5, 1568, 2093].forEach(function (f, n) {
          tone(f, 0.24 + n * 0.07, 0.9, { level: 0.06 });
          tone(f * 2, 0.24 + n * 0.07, 0.4, { level: 0.012 });
        });
      } },
      bell: { name: 'Glass bell', play: function () { bell(1318.5, 0.2, 1.8, 0.07); bell(1975.5, 0.32, 1.4, 0.035); } },
      musicbox: { name: 'Music box', play: function () {
        [1568, 1760, 2093, 2637, 2349.3].forEach(function (f, n) {
          tone(f, 0.2 + n * 0.09, 0.5, { type: 'triangle', level: 0.045, attack: 0.003 });
        });
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 2600); tick(0.24, 3200); } }
    },
    sunset: {
      swell: { name: 'Warm swell', play: function () {
        var filter = warmFilter(1800, 2.2);
        [196, 196 * 1.006, 246.9, 293.7].forEach(function (f) {
          tone(f, 0.15, 2.2, { type: 'triangle', level: 0.05, attack: 0.45, glide: 0.97, into: filter });
        });
      } },
      hum: { name: 'Low hum', play: function () {
        var filter = warmFilter(900, 2.4);
        [130.8, 196, 261.6].forEach(function (f, n) {
          tone(f, 0.12, 2.4, { level: 0.07 - n * 0.015, attack: 0.6, into: filter });
        });
      } },
      windchime: { name: 'Wind chimes', play: function () {
        [1174.7, 1396.9, 1046.5, 1568, 1318.5].forEach(function (f, n) {
          bell(f, 0.2 + n * 0.16 + Math.random() * 0.05, 1.2, 0.03);
        });
        noise(0.05, 1.2, 800, 2000, 0.015);
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 1800); tick(0.26, 1400); } }
    },
    dark: {
      pings: { name: 'Night pings', play: function () {
        tone(220, 0.12, 1.4, { level: 0.09, attack: 0.08 });
        tone(330, 0.16, 1.2, { level: 0.04, attack: 0.1 });
        [1760, 2349.3, 2093, 2637].forEach(function (f, n) {
          tone(f, 0.42 + n * 0.12, 0.5, { type: 'triangle', level: 0.035 });
        });
      } },
      deepbell: { name: 'Deep bell', play: function () { bell(196, 0.16, 2.6, 0.09); tone(98, 0.16, 2.2, { level: 0.04, attack: 0.05 }); } },
      twinkle: { name: 'Twinkle', play: function () {
        [2637, 3136, 2793.8, 3520, 2349.3, 3951].forEach(function (f, n) {
          tone(f, 0.38 + n * 0.09, 0.35, { level: 0.028, attack: 0.004 });
        });
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 1200); tick(0.26, 900); } }
    },
    slide: {
      whoosh: { name: 'Whoosh', play: function (distance) { noise(0, 0.32 + 0.12 * distance, 500, 2200, 0.05); } },
      tick: { name: 'Click', play: function () { tick(0, 1600); } },
      none: { name: 'None', play: function () {} }
    },
    // Extra sounds for the globe's own buttons
    globe: {
      snow: { name: 'Snow', play: function () {
        [2093, 2637, 3136, 2349.3, 3520].forEach(function (f, n) { tone(f, 0.05 + n * 0.11, 0.6, { level: 0.03, attack: 0.004 }); });
      } },
      rain: { name: 'Rain', play: function () { noise(0, 1.4, 1800, 5200, 0.03); tone(146.8, 0.05, 1.6, { level: 0.05, attack: 0.3 }); } },
      shake: { name: 'Shake', play: function () { noise(0, 0.5, 600, 2600, 0.06); bell(1568, 0.12, 1.0, 0.03); bell(2093, 0.22, 0.9, 0.025); } },
      live: { name: 'Live', play: function () { tone(880, 0.02, 0.35, { level: 0.05 }); tone(1318.5, 0.12, 0.6, { level: 0.05 }); } }
    }
  };

  function playSound(group, id, distance) {
    if (!audio()) return;
    var sound = SOUND_LIBRARY[group] && SOUND_LIBRARY[group][id];
    if (sound) sound.play(distance || 1);
  }

  /* ---------- Sound on/off ---------- */

  var soundOn = read(SOUND_KEY) !== 'off';

  function whenReady(go) {
    if (!soundOn || !audio()) return;
    if (ctx.state === 'running') go();
    else ctx.resume().then(go, go);
  }
  function play(mood, distance) {
    whenReady(function () {
      playSound('slide', SOUND_CHOICE.slide, distance);
      playSound(mood, SOUND_CHOICE[mood], distance);
    });
  }

  function setSound(on) {
    soundOn = on;
    soundButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundLabel.textContent = 'Sound';                 // one name; the pressed state says whether it is on
    soundButton.dataset.tip = on ? 'Sound on' : 'Sound off';
    write(SOUND_KEY, on ? 'on' : 'off');
    // Turning sound off silences it at once, including a note that is still ringing.
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.015);
    }
    if (silentLoop) {
      if (on) { var p = silentLoop.play(); if (p && p.catch) p.catch(function () {}); }
      else silentLoop.pause();
    }
  }

  soundButton.addEventListener('click', function () { setSound(!soundOn); });
  setSound(soundOn);

  /* ---------- Mood ---------- */

  function squash(distance) {
    if (!face.animate || reduced.matches) return;
    var stretch = 1 + 0.16 * Math.max(1, distance);
    face.animate(
      [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(' + stretch + ', ' + (2 - stretch) + ')', offset: 0.45 },
        { transform: 'scale(0.96, 1.04)', offset: 0.8 },
        { transform: 'scale(1, 1)' }
      ],
      { duration: 640, easing: 'ease-in-out' }
    );
  }

  // Moves the knob. Returns how many stops it travelled (0 if it was already there).
  function setMood(mood, animate) {
    var from = moods.indexOf(root.dataset.mood);
    var i = moods.indexOf(mood);
    if (i < 0) return 0;
    root.dataset.mood = mood;
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = { light: '#F6F6F4', sunset: '#2D253A', dark: '#1A1A1A' }[mood];
    toggle.style.setProperty('--i', i);
    stops.forEach(function (s, n) {
      s.setAttribute('aria-checked', n === i ? 'true' : 'false');
      s.tabIndex = n === i ? 0 : -1;
    });
    var distance = Math.abs(i - from);
    if (animate && distance) { play(mood, distance); squash(distance); }
    return distance;
  }

  // A person chose a stop: move, then tell the globe. Choosing the stop the knob is
  // already on still counts, because it leaves Live for a preview.
  function pick(mood) {
    // The globe is told even if the sound or the squash fails on this device.
    try { if (!setMood(mood, true)) { play(mood, 1); squash(0.4); } } catch (e) {}
    document.dispatchEvent(new CustomEvent('globe:pick', { detail: { mood: mood } }));
  }

  stops.forEach(function (s) {
    s.addEventListener('click', function () { pick(s.dataset.mood); });
  });

  // Arrow keys move between stops, like any radio group
  toggle.addEventListener('keydown', function (e) {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;    // leave browser shortcuts alone
    var i = moods.indexOf(root.dataset.mood);
    var next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: moods.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    next = (next + moods.length) % moods.length;
    pick(moods[next]);
    stops[next].focus();
  });

  setMood(root.dataset.mood || 'dark', false);

  window.globeSwitch = {
    set: setMood,
    mood: function () { return root.dataset.mood; },
    sound: function (id) { whenReady(function () { playSound('globe', id, 1); }); }
  };
})();