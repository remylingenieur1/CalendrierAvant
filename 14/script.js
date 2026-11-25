// ---- music.js ----
(() => {
const ROOT_FREQUENCY = 130.8127826502993; // C3
const naturalData = [
  ['C3', 'do', 0], ['D3', 're', 2], ['E3', 'mi', 4], ['F3', 'fa', 5],
  ['G3', 'sol', 7], ['A3', 'la', 9], ['B3', 'si', 11], ['C4', 'do', 12],
];
const sharpData = [
  ['C♯3', 'do♯', 1, .5], ['D♯3', 're♯', 3, 1.5],
  ['F♯3', 'fa♯', 6, 3.5], ['G♯3', 'la♭', 8, 4.5], ['A♯3', 'si♭', 10, 5.5],
];
const NATURAL_NOTES = Object.freeze(naturalData.map(([name, label, semitone], slot) =>
  Object.freeze({ name, label, semitone, slot, kind: 'natural', frequency: ROOT_FREQUENCY * 2 ** (semitone / 12) })));
const SHARP_NOTES = Object.freeze(sharpData.map(([name, label, semitone, slot]) =>
  Object.freeze({ name, label, semitone, slot, kind: 'sharp', frequency: ROOT_FREQUENCY * 2 ** (semitone / 12) })));

const NOTES = Object.freeze([...NATURAL_NOTES, ...SHARP_NOTES]);
function installedNotes(count) {
  return NOTES.slice(0, Math.max(0, Math.min(NOTES.length, count))).sort((a, b) => a.slot - b.slot);
}

function synthesizePluck(frequency, sampleRate, duration = 4.5) {
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  for (let harmonic = 1; harmonic <= 12; harmonic++) {
    const partial = frequency * harmonic * Math.sqrt(1 + .000035 * harmonic * harmonic);
    if (partial > sampleRate * .45) break;
    const amplitude = Math.pow(harmonic, -1.65) * Math.sin(harmonic * .38);
    const decay = 1.5 / Math.pow(harmonic, .57);
    const step = 2 * Math.PI * partial / sampleRate;
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      const attack = Math.min(1, time / .004);
      samples[i] += Math.sin(step * i) * amplitude * attack * Math.exp(-time / decay) * .65;
    }
  }

  const fade = Math.min(samples.length, Math.ceil(sampleRate * .1));
  for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
  samples[samples.length - 1] = 0;
  return samples;
}

  globalThis.HarpMusic = Object.freeze({ ROOT_FREQUENCY, NOTES, NATURAL_NOTES, SHARP_NOTES, installedNotes, synthesizePluck });
})();

;
// ---- geometry.js ----
// Horizontal string positions are calculated by CSS sibling functions.
(() => {
  const pegPositions = Object.freeze([25.98072953, 31.48657949, 37.4053682, 43.7026841, 49.79353063, 56.22849277, 63.21403992, 69.23606332]);
  const profile = [[24.088094, 56.786704, 79.778393], [25.12044, 56.140351, 80.701754], [26.152787, 55.493998, 81.440443], [27.185134, 54.847645, 82.086796], [28.217481, 54.201293, 82.640813], [29.249828, 53.55494, 83.102493], [30.282175, 53.000923, 83.564174], [31.314522, 52.262235, 83.841182], [32.346869, 51.708218, 84.210526], [33.379215, 51.061865, 84.487535], [34.411562, 50.415512, 84.672207], [35.443909, 49.76916, 84.949215], [36.476256, 49.122807, 85.133887], [37.508603, 48.56879, 85.226223], [38.54095, 47.922438, 85.31856], [39.573297, 47.276085, 85.410896], [40.605643, 46.722068, 85.503232], [41.63799, 46.075716, 85.595568], [42.670337, 45.429363, 85.595568], [43.702684, 44.78301, 85.595568], [44.735031, 44.228994, 85.595568], [45.767378, 43.582641, 85.595568], [46.799725, 43.028624, 85.503232], [47.832072, 42.382271, 85.503232], [48.864418, 41.735919, 85.410896], [49.896765, 41.181902, 85.410896], [50.929112, 40.535549, 85.503232], [51.961459, 39.981533, 85.503232], [52.993806, 39.33518, 85.503232], [54.026153, 38.688827, 85.503232], [55.0585, 38.134811, 85.503232], [56.090847, 37.488458, 85.410896], [57.123193, 36.934441, 85.410896], [58.15554, 36.288089, 85.31856], [59.187887, 35.641736, 85.226223], [60.220234, 35.087719, 85.226223], [61.252581, 34.533703, 85.041551], [62.284928, 33.88735, 84.949215], [63.317275, 33.333333, 84.764543], [64.349621, 32.686981, 84.579871], [65.381968, 32.132964, 84.302862], [66.414315, 31.486611, 84.025854], [67.446662, 30.932595, 83.65651], [68.479009, 30.286242, 83.287165], [69.511356, 29.639889, 82.825485], [70.543703, 29.085873, 82.179132], [71.57605, 28.43952, 81.532779], [72.608396, 27.885503, 80.609418], [73.640743, 27.239151, 79.501385], [74.67309, 29.824561, 78.116343], [75.705437, 37.396122, 76.361958]];
  function stringBounds(xPercent) {
    const x = Math.max(profile[0][0], Math.min(profile.at(-1)[0], xPercent));
    const right = Math.max(1, profile.findIndex(point => point[0] >= x));
    const before = profile[right - 1];
    const after = profile[right];
    const t = (x - before[0]) / (after[0] - before[0]);
    const top = before[1] + (after[1] - before[1]) * t;
    const bottom = before[2] + (after[2] - before[2]) * t;
    return { top, height: bottom - top };
  }
  globalThis.HarpGeometry = Object.freeze({ stringBounds, pegPositions });
})();

;
// ---- harp.js ----
const { NOTES, NATURAL_NOTES, synthesizePluck } = globalThis.HarpMusic;

const harp = document.querySelector('.harp');
const strings = document.querySelector('.strings');
const addButton = document.querySelector('.add-string');
const removeButton = document.querySelector('.remove-string');
const status = document.querySelector('#status');
const motes = document.querySelector('.motes');
const nativeSiblings = CSS.supports('top: calc(sibling-index() * 1px)') && CSS.supports('z-index: sibling-count()');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const installed = new Map();
const activeAnimations = new Map();
const activePointers = new Map();
const slots = [];
let playHistory = [];
let audio;
let animationFrame = 0;
let lastPointerPluck = { element: null, time: 0 };

class HarpAudio {
  constructor() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio is unavailable in this browser.');
    this.context = new AudioContextClass();
    this.buffers = new Map();
    this.voices = new Set();
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = .7;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -15;
    compressor.knee.value = 15;
    compressor.ratio.value = 5;
    this.master.connect(compressor).connect(context.destination);
    const reverb = context.createConvolver();
    const length = Math.floor(context.sampleRate * 2);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * .31)) * .5;
    }
    reverb.buffer = impulse;
    this.wet = context.createGain();
    this.wet.gain.value = .17;
    reverb.connect(this.wet).connect(this.master);
    this.reverb = reverb;
  }

  stopNote(name) {
    for (const voice of this.voices) {
      if (voice.noteName !== name) continue;
      voice.gain.gain.setTargetAtTime(0, this.context.currentTime, .015);
      voice.source.stop(this.context.currentTime + .07);
      this.voices.delete(voice);
    }
  }

  async unlock() {
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Tap a string again to enable sound.');
  }

  play(note, strength = .8) {
    const context = this.context;
    if (!this.buffers.has(note.name)) {
      const samples = synthesizePluck(note.frequency, context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(note.name, buffer);
    }
    // Bound polyphony during fast glissandi. Fade the oldest voice first.
    if (this.voices.size >= 28) {
      const oldest = this.voices.values().next().value;
      oldest.gain.gain.setTargetAtTime(0, context.currentTime, .015);
      oldest.source.stop(context.currentTime + .07);
      this.voices.delete(oldest);
    }
    const source = context.createBufferSource();
    source.buffer = this.buffers.get(note.name);
    const gain = context.createGain();
    gain.gain.value = .55 * strength;
    const pan = context.createStereoPanner();
    pan.pan.value = (note.slot / 7 - .5) * .7;
    source.connect(gain).connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverb);
    const voice = { source, gain, noteName: note.name };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start();
  }
}

function prepareAudio() {
  try {
    if (!audio) audio = new HarpAudio();
    return audio.unlock();
  } catch (error) {
    return Promise.reject(error);
  }
}

function animateStrings(now) {
  for (const [button, animation] of activeAnimations) {
    const elapsed = (now - animation.start) / 1000;
    const decay = Math.exp(-elapsed * 1.35);
    const amplitude = reducedMotion.matches ? 0 : animation.strength * 19 * decay;
    const phase = elapsed * 2 * Math.PI * 11;
    const swing = Math.sin(phase) * amplitude;
    const harmonic = Math.sin(phase * 2.03) * amplitude * .2;
    const path = bend => `M0 0 C${bend + harmonic} 24 ${bend - harmonic} 76 0 100`;
    button.querySelector('.wire').setAttribute('d', path(swing));
    button.querySelector('.wire-glow').setAttribute('d', path(swing));
    button.querySelector('.wire-echo-left').setAttribute('d', path(-amplitude * .72));
    button.querySelector('.wire-echo-right').setAttribute('d', path(amplitude * .72));
    button.style.setProperty('--energy', decay.toFixed(3));
    if (elapsed > 3.2) {
      button.classList.remove('sounding');
      button.querySelectorAll('path').forEach(wire => wire.setAttribute('d', 'M0 0L0 100'));
      button.style.removeProperty('--energy');
      activeAnimations.delete(button);
    }
  }
  animationFrame = activeAnimations.size ? requestAnimationFrame(animateStrings) : 0;
}

function sparkle(button) {
  if (reducedMotion.matches || motes.childElementCount > 48) return;
  const frame = harp.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  for (let i = 0; i < 4; i++) {
    const mote = document.createElement('i');
    mote.className = 'mote';
    mote.style.left = `${rect.left + rect.width / 2 - frame.left}px`;
    mote.style.top = `${rect.top + rect.height * (.3 + Math.random() * .4) - frame.top}px`;
    mote.style.setProperty('--dx', `${(Math.random() - .5) * 65}px`);
    mote.style.setProperty('--dy', `${-15 - Math.random() * 65}px`);
    mote.addEventListener('animationend', () => mote.remove(), { once: true });
    motes.append(mote);
  }
}

function pluck(button, strength = .8) {
  const note = installed.get(button.dataset.note)?.note;
  if (!note) return;
  playHistory = playHistory.filter(name => name !== note.name);
  playHistory.push(note.name);
  updateControls();
  button.classList.add('sounding');
  activeAnimations.set(button, { start: performance.now(), strength });
  const label = button.querySelector('.note-label');
  label.getAnimations().forEach(animation => animation.cancel());
  if (!reducedMotion.matches) {
    label.animate([
      { opacity: .35, filter: 'blur(1.1px)', offset: 0 },
      { opacity: 1, filter: 'blur(.25px)', offset: .08 },
      { opacity: .78, filter: 'blur(.7px)', offset: .15 },
      { opacity: .96, filter: 'blur(.3px)', offset: .23 },
      { opacity: .82, filter: 'blur(.8px)', offset: .34 },
      { opacity: 1, filter: 'blur(.2px)', offset: .43 },
      { opacity: .76, filter: 'blur(.7px)', offset: .56 },
      { opacity: .9, filter: 'blur(.4px)', offset: .66 },
      { opacity: .68, filter: 'blur(.8px)', offset: .78 },
      { opacity: 0, filter: 'blur(1.6px)', offset: 1 },
    ], { duration: 2900, easing: 'linear' });
  }
  if (!animationFrame) animationFrame = requestAnimationFrame(animateStrings);
  sparkle(button);
  prepareAudio().then(() => { if (installed.has(note.name)) audio.play(note, strength); }).catch(error => {
    status.textContent = error.message;
  });
}

function createString(note) {
  const button = document.createElement('button');
  button.className = 'string';
  button.type = 'button';
  button.dataset.note = note.name;
  if (note.kind === 'sharp') button.classList.add('string--sharp');
  button.setAttribute('aria-label', `Pluck ${note.label}, ${note.name}`);
  button.innerHTML = `<svg class="string-wire" viewBox="-40 0 80 100" preserveAspectRatio="none" aria-hidden="true"><path class="wire-glow" d="M0 0L0 100"/><path class="wire-echo wire-echo-left" d="M0 0L0 100"/><path class="wire-echo wire-echo-right" d="M0 0L0 100"/><path class="wire" d="M0 0L0 100"/></svg><span class="note-label" aria-hidden="true">${note.label}</span>`;
  button.addEventListener('click', event => {
    // Pointer plucks happen on contact; retain click for keyboard and assistive tech.
    if (event.detail === 0 || lastPointerPluck.element !== button || performance.now() - lastPointerPluck.time > 800) pluck(button);
  });
  return button;
}

function fitStrings() {
  const frame = harp.getBoundingClientRect();
  if (!frame.width) return;
  for (const { button } of installed.values()) {
    // Read the CSS result: JS only fits the top/bottom to the frame's outline.
    const rect = button.getBoundingClientRect();
    const x = (rect.left + rect.width / 2 - frame.left) / frame.width * 100;
    const bounds = globalThis.HarpGeometry.stringBounds(x);
    button.style.setProperty('--string-top', `${bounds.top}%`);
    button.style.setProperty('--string-length', `${bounds.height}%`);
  }
}

function updateControls() {
  const next = NOTES.find(note => !installed.has(note.name));
  addButton.disabled = !next;
  addButton.setAttribute('aria-label', next ? `Add ${next.label}, ${next.name}` : 'All thirteen strings added');
  addButton.title = next ? `Add ${next.label}` : 'All thirteen strings added';
  const latest = playHistory.at(-1);
  const lastNote = latest ? installed.get(latest)?.note : null;
  removeButton.disabled = !lastNote;
  removeButton.setAttribute('aria-label', lastNote ? `Remove ${lastNote.label}, most recently played note` : 'Play a note to remove it');
  removeButton.title = lastNote ? `Remove ${lastNote.label}, most recently played` : 'Play a note to remove it';
}

function addNote(note) {
  const button = createString(note);
  installed.set(note.name, { note, button });
  slots[Math.floor(note.slot)].append(button);
  harp.style.setProperty('--installed-count', installed.size);
  fitStrings();
  updateControls();
  return button;
}

addButton.addEventListener('click', () => {
  activePointers.clear();
  const note = NOTES.find(candidate => !installed.has(candidate.name));
  if (!note) return;
  addButton.classList.remove('inviting');
  const button = addNote(note);
  pluck(button, .7);
  status.textContent = `${installed.size} strings. Added ${note.label}, ${note.name}.`;
});

removeButton.addEventListener('click', () => {
  activePointers.clear();
  const name = playHistory.pop();
  const entry = installed.get(name);
  if (!entry) return;
  activeAnimations.delete(entry.button);
  entry.button.querySelector('.note-label').getAnimations().forEach(animation => animation.cancel());
  entry.button.remove();
  installed.delete(name);
  audio?.stopNote(name);
  for (const pointer of activePointers.values()) if (pointer.last === entry.button) pointer.last = null;
  harp.style.setProperty('--installed-count', installed.size);
  updateControls();
  status.textContent = `${installed.size} strings. Removed ${entry.note.label}, the most recently played note.`;
});

function contactPluck(button, strength) {
  lastPointerPluck = { element: button, time: performance.now() };
  pluck(button, strength);
}

harp.addEventListener('pointerdown', event => {
  if (event.target.closest('.change-string') || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const button = event.target.closest('.string');
  // Cancel implicit touch capture so glissandi can pass between strings.
  if (event.target.hasPointerCapture?.(event.pointerId)) event.target.releasePointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, last: button });
  if (button) contactPluck(button, event.pressure > 0 && event.pointerType !== 'mouse' ? .55 + event.pressure * .45 : .85);
});

harp.addEventListener('pointermove', event => {
  if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
    activePointers.delete(event.pointerId);
    return;
  }
  const previous = activePointers.get(event.pointerId);
  if (!previous) return;
  const dx = event.clientX - previous.x;
  const hits = [];
  // Intersect the whole movement segment: fast sweeps cannot skip thin strings.
  for (const { button } of installed.values()) {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const t = dx ? (x - previous.x) / dx : -1;
    if (t > 0 && t <= 1) {
      const y = previous.y + (event.clientY - previous.y) * t;
      if (y >= rect.top && y <= rect.bottom) hits.push({ button, t });
    }
  }
  hits.sort((a, b) => a.t - b.t).forEach(({ button }) => {
    if (button !== previous.last) contactPluck(button, Math.min(1, .6 + Math.abs(dx) / 180));
  });
  const last = hits.length ? hits[hits.length - 1].button : previous.last;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, last });
});

function releasePointer(event) { activePointers.delete(event.pointerId); }
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);
window.addEventListener('blur', () => activePointers.clear());
document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (/^[1-9]$/.test(event.key)) {
    const button = [...installed.values()].sort((a, b) => a.note.slot - b.note.slot)[Number(event.key) - 1]?.button;
    if (button) { event.preventDefault(); pluck(button); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { activePointers.clear(); audio?.context.suspend(); }
});
// Eight persistent diatonic slots keep the main notes fixed when a sharp is
// inserted or an arbitrary played note is removed. CSS calculates the baseline;
// small artwork-specific corrections align the strings with the drawn pegs.
const pegPositions = globalThis.HarpGeometry.pegPositions;
const pegStart = pegPositions[0];
const pegSpan = pegPositions.at(-1) - pegStart;
const pegCorrections = pegPositions.map((peg, index) => peg - pegStart - pegSpan * index / (pegPositions.length - 1));
strings.style.setProperty('--peg-start', `${pegStart}%`);
strings.style.setProperty('--peg-span', `${pegSpan}%`);
NATURAL_NOTES.forEach((note, index) => {
  const slot = document.createElement('div');
  slot.className = 'note-slot';
  slot.style.setProperty('--peg-correction', `${pegCorrections[index]}%`);
  slot.style.setProperty('--next-peg-correction', `${pegCorrections[Math.min(index + 1, pegCorrections.length - 1)]}%`);
  if (!nativeSiblings) {
    slot.style.setProperty('--fallback-index', index + 1);
    slot.style.setProperty('--fallback-count', NATURAL_NOTES.length);
  }
  slots.push(slot);
  strings.append(slot);
});
for (const note of NATURAL_NOTES) {
  addNote(note);
}
new ResizeObserver(fitStrings).observe(harp);
addButton.classList.add('inviting');
