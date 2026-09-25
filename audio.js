// Pond soundscape, all synthesised with Web Audio: looping ambience, sparse zen instruments and water sounds
// for interactions. Nothing is downloaded; buffers are rendered in plain JS the first time they are needed.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const MUSIC = ['guqin', 'bowl', 'chimes', 'off'];

  // ---------- Offline synthesis ----------
  const noise = n => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return d; };
  // One-pole filter run over the buffer twice, so the loop point continues the filter state and has no seam.
  function onePole(data, cutoff, sr, high = false) {
    const a = Math.exp(-TAU * cutoff / sr); let y = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < data.length; i++) { const x = data[i]; y = (1 - a) * x + a * y; if (pass) data[i] = high ? x - y : y; }
    return data;
  }
  const band = (d, lo, hi, sr) => onePole(onePole(d, hi, sr), lo, sr, true);
  function mixInto(L, R, src, gain, pan = 0, lfo) {
    const gl = Math.cos((pan + 1) * Math.PI / 4) * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
    for (let i = 0; i < src.length; i++) { const k = lfo ? lfo(i) : 1; L[i] += src[i] * gl * k; R[i] += src[i] * gr * k; }
  }
  // A small air bubble closing at the surface: a sine whose pitch rises as it shrinks. Wraps around the loop.
  function bubble(L, R, sr, t0, f0, dur, amp, pan, rise) {
    const n = Math.floor(dur * sr * 3), start = Math.floor(t0 * sr), len = L.length, gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = f0 * (1 + rise * Math.min(1, t / dur)); ph += TAU * f / sr;
      const v = Math.sin(ph) * Math.min(1, t / .0012) * Math.exp(-t / (dur * .35)), k = (start + i) % len;
      L[k] += v * gl; R[k] += v * gr;
    }
  }
  function normalize(L, R, peak) { let m = 1e-6; for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); const k = peak / m; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; } }
  // Periodic modulation with whole cycles over the loop, so it matches at the seam.
  const loopLfo = (n, parts) => i => parts.reduce((v, [cycles, depth, ph]) => v + depth * Math.sin(TAU * cycles * i / n + ph), 1);

  const AMBIENT_SYNTH = {
    stream(sr) {
      const n = sr * 12, L = new Float32Array(n), R = new Float32Array(n);
      for (const pan of [-.6, .6]) mixInto(L, R, band(noise(n), 260, 1500, sr), .32, pan, loopLfo(n, [[2, .22, 0], [5, .12, 1], [11, .06, 2]]));
      mixInto(L, R, band(noise(n), 60, 260, sr), .5, 0);
      for (let t = 0; t < 12; t += rand(.004, .045)) {
        const f0 = 320 * Math.pow(2, rand(0, 2.3)), gurgle = Math.random() < .05;
        const count = gurgle ? 4 + Math.floor(rand(0, 6)) : 1;
        for (let k = 0; k < count; k++) bubble(L, R, sr, t + k * rand(.015, .04), f0 * rand(.85, 1.2), 14 / f0 + rand(.004, .014), .22 * Math.pow(Math.random(), 2.2), rand(-.8, .8), rand(.25, 1.1));
      }
      normalize(L, R, .8); return [L, R];
    },
    // Rain on the pond: a hiss, a low body of water noise and a crackle of drops; density sets light or heavy.
    rain(sr, density) {
      const n = sr * 10, L = new Float32Array(n), R = new Float32Array(n);
      for (const pan of [-.7, .7]) mixInto(L, R, band(noise(n), 900, 6500, sr), .06 + .14 * density, pan, loopLfo(n, [[3, .1, pan]]));
      const gap = .025 - .021 * density;
      for (let t = 0; t < 10; t += rand(gap * .2, gap)) {
        const f0 = 900 * Math.pow(2, rand(0, 2.2));
        bubble(L, R, sr, t, f0, rand(.003, .008), .09 * Math.pow(Math.random(), 1.6), rand(-.9, .9), rand(0, .3));
        if (Math.random() < .08) { const f1 = 500 * Math.pow(2, rand(0, 1.6)); bubble(L, R, sr, t, f1, 12 / f1 + .01, .14 * Math.random(), rand(-.8, .8), rand(.5, 1.2)); }
      }
      normalize(L, R, .45 + .3 * density); return [L, R];
    },
    night(sr) {
      const n = sr * 8, L = new Float32Array(n), R = new Float32Array(n);
      // Crickets: pulses of a pure tone grouped in chirps, each insect with its own pitch, rhythm and place.
      for (let c = 0; c < 4; c++) {
        const f = rand(3900, 5100), per = 8 / Math.round(8 / rand(.5, .95)), pulses = 3 + (c % 2), amp = rand(.05, .11), pan = rand(-.85, .85), off = rand(0, per);
        const gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
        for (let t0 = off; t0 < 8 + per; t0 += per) for (let p = 0; p < pulses; p++) {
          const s = Math.floor((t0 + p * .03) * sr), m = Math.floor(.016 * sr);
          for (let i = 0; i < m; i++) { const env = Math.sin(Math.PI * i / m) ** 2, v = Math.sin(TAU * f * (s + i) / sr) * env, k = (s + i) % n; L[k] += v * gl; R[k] += v * gr; }
        }
      }
      mixInto(L, R, band(noise(n), 5200, 9000, sr), .018, 0, loopLfo(n, [[48, .6, 0]]));
      normalize(L, R, .7); return [L, R];
    },
    // A mountain spring: a thin trickle and clear drops ringing in a rocky basin.
    spring(sr) {
      const n = sr * 10, L = new Float32Array(n), R = new Float32Array(n);
      for (const pan of [-.5, .5]) mixInto(L, R, band(noise(n), 900, 3400, sr), .07, pan, loopLfo(n, [[7, .35, pan], [13, .2, 1]]));
      for (let t = 0; t < 10; t += rand(.07, .45)) {
        const f0 = 850 * Math.pow(2, rand(0, 1.5)), amp = rand(.12, .3), pan = rand(-.6, .6), dur = 14 / f0 + .02;
        bubble(L, R, sr, t, f0, dur, amp, pan, rand(.6, 1.4)); bubble(L, R, sr, t + .09, f0, dur, amp * .3, -pan, rand(.6, 1.4));
      }
      normalize(L, R, .7); return [L, R];
    },
    // Water tumbling over a little ledge of stones: fuller, brighter and busy with bubbles.
    cascade(sr) {
      const n = sr * 12, L = new Float32Array(n), R = new Float32Array(n);
      for (const pan of [-.7, .7]) mixInto(L, R, band(noise(n), 180, 5200, sr), .55, pan, loopLfo(n, [[3, .12, pan], [9, .06, 2]]));
      mixInto(L, R, band(noise(n), 70, 220, sr), .35, 0, loopLfo(n, [[2, .1, 0]]));
      for (let t = 0; t < 12; t += rand(.002, .012)) { const f0 = 380 * Math.pow(2, rand(0, 2.4)); bubble(L, R, sr, t, f0, 12 / f0 + .005, .1 * Math.pow(Math.random(), 1.8), rand(-.9, .9), rand(.3, 1)); }
      normalize(L, R, .75); return [L, R];
    },
    // Still pond water lapping at the stones: slow swells with a soft plop at each.
    lapping(sr) {
      const n = sr * 12, L = new Float32Array(n), R = new Float32Array(n), laps = [];
      for (let t = rand(0, .5); t < 12; t += rand(1.5, 3)) laps.push([t, rand(.6, 1), rand(-.6, .6)]);
      for (const pan of [-.4, .4]) {
        const d = band(noise(n), 90, 700, sr);
        mixInto(L, R, d, .7, pan, i => { const t = i / sr; let e = .06; for (const [t0, a] of laps) { const u = ((t - t0) % 12 + 12) % 12; e += a * (u < .3 ? u / .3 : Math.exp(-(u - .3) / .7)); } return e; });
      }
      for (const [t0, a, pan] of laps) for (let k = 0; k < 3; k++) { const f0 = rand(260, 620); bubble(L, R, sr, t0 + .25 + k * rand(.05, .2), f0, 14 / f0 + .03, .18 * a * rand(.4, 1), pan, rand(.3, .8)); }
      normalize(L, R, .6); return [L, R];
    },
    // The thin stream feeding a bamboo spout (竹筒惊鹿), punctuated by live knocks.
    trickle(sr) {
      const n = sr * 10, L = new Float32Array(n), R = new Float32Array(n);
      mixInto(L, R, band(noise(n), 1100, 4200, sr), .16, -.2, loopLfo(n, [[23, .3, 0], [41, .2, 1]]));
      for (let t = 0; t < 10; t += rand(.02, .09)) { const f0 = 1200 * Math.pow(2, rand(0, 1.3)); bubble(L, R, sr, t, f0, 10 / f0 + .004, .08 * Math.random(), rand(-.4, .1), rand(.4, 1)); }
      normalize(L, R, .5); return [L, R];
    }
  };
  const WATERS = ['stream', 'spring', 'cascade', 'lapping', 'bamboo'];
  // Loops for the weather of the moment; birds, frogs, drops and thunder are added as live events.
  // Weather loops carry no water or wind (those belong to the water setting): rain on the pond, or insects at night.
  function weatherLayers({ weather, night, rain }) {
    if (weather === 'rain') return { rainLight: .95 - .6 * rain, rainHeavy: .15 + .85 * rain };
    return night && weather !== 'snow' ? { night: .9 } : {};
  }

  // Plucked string (Karplus–Strong) with a soft, woody excitation: our guqin.
  function pluck(sr, freq, dur) {
    const n = Math.floor(sr * dur), out = new Float32Array(n), N = Math.max(2, Math.round(sr / freq)), buf = new Float32Array(N);
    let lp = 0; for (let i = 0; i < N; i++) { lp += (Math.random() * 2 - 1 - lp) * .45; buf[i] = lp * (1 - i / N * .3); }
    const decay = Math.pow(.001, 1 / (Math.max(3, 9 - freq / 60) * freq));
    let idx = 0, body = 0;
    for (let i = 0; i < n; i++) {
      const k = (idx + 1) % N, v = buf[idx];
      buf[idx] = decay * (buf[idx] * .52 + buf[k] * .48); idx = k;
      body += (v - body) * .35;
      out[i] = (v * .55 + body * .6) * Math.min(1, i / (sr * .003)) * Math.min(1, (n - i) / (sr * .3));
    }
    return out;
  }
  // Inharmonic partials, each split in two so the pair beats slowly: a struck bowl or a chime tube.
  function struck(sr, f0, dur, partials, strike) {
    const n = Math.floor(sr * dur), out = new Float32Array(n);
    for (const [ratio, amp, decay, beat] of partials) {
      const f = f0 * ratio; if (f > sr * .45) continue;
      for (const s of [-1, 1]) { const w = TAU * (f + s * beat / 2) / sr, ph = Math.random() * TAU; for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + ph) * amp * .5 * Math.exp(-i / sr / decay); }
    }
    const m = Math.floor(sr * .02), hit = band(noise(m), f0, f0 * 6, sr);
    for (let i = 0; i < m; i++) out[i] += hit[i] * strike * (1 - i / m);
    let peak = 1e-6; for (let i = 0; i < n; i++) { out[i] *= Math.min(1, i / (sr * .004)) * Math.min(1, (n - i) / (sr * .5)); peak = Math.max(peak, Math.abs(out[i])); }
    for (let i = 0; i < n; i++) out[i] *= .8 / peak;
    return out;
  }
  const GUQIN = [130.81, 146.83, 174.61, 196, 220, 261.63, 293.66, 349.23, 392, 440];
  const BOWLS = [146.83, 196, 261.63];
  const TUBES = [523.25, 587.33, 659.25, 783.99, 880];

  const unit = v => Math.max(0, Math.min(1, Number(v)));
  class PondAudio {
    constructor() {
      this.active = false; this.context = null; this.layers = {}; this.buffers = {}; this.timer = 0; this.next = 0; this.events = {};
      this.opts = { water: true, waterType: 'stream', waterVol: .6, weatherSound: true, weatherVol: .6, music: 'guqin', musicVol: .5, sfx: true, volume: .7 };
      this.scene = { weather: 'sunny', night: false, rain: .5 };
    }
    configure(settings) {
      const vol = (v, d) => Number.isFinite(Number(v)) ? unit(v) : d;
      this.opts = { water: settings.water !== false, waterType: WATERS.includes(settings.waterType) ? settings.waterType : 'stream', waterVol: vol(settings.waterVol, .6), weatherSound: settings.weatherSound !== false, weatherVol: vol(settings.weatherVol, .6), music: MUSIC.includes(settings.music) ? settings.music : 'guqin', musicVol: vol(settings.musicVol, .5), sfx: settings.sfx !== false, volume: vol(settings.volume, .7) };
      this.scene = { weather: settings.weather, night: !!settings.night, rain: vol(settings.rainAmount, .5) };
      if (!this.context) return;
      const now = this.context.currentTime, o = this.opts;
      this.master.gain.setTargetAtTime(o.volume, now, .1);
      this.waterBus.gain.setTargetAtTime(o.water ? o.waterVol * .7 : 0, now, .3);
      this.weatherBus.gain.setTargetAtTime(o.weatherSound ? o.weatherVol * .75 : 0, now, .3);
      this.musicBus.gain.setTargetAtTime(o.musicVol * .9, now, .3);
      if (this.active) this.refresh();
    }
    setup() {
      const ctx = this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = this.opts.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      // A soft hall for the instruments: decaying stereo noise, darker as it fades.
      const len = Math.floor(ctx.sampleRate * 3.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let y = 0; for (let i = 0; i < len; i++) { const t = i / len, a = .2 + .75 * t; y = (1 - a) * (Math.random() * 2 - 1) + a * y; d[i] = y * Math.pow(1 - t, 2.2) * (i < 200 ? i / 200 : 1); } }
      this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = .55; this.reverb.connect(wet).connect(this.master);
      const bus = (verb) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master); if (verb) { const v = ctx.createGain(); v.gain.value = verb; g.connect(v).connect(this.reverb); } return g; };
      this.waterBus = bus(0); this.weatherBus = bus(.18); this.musicBus = bus(1); this.sfxBus = bus(.12); this.sfxBus.gain.value = .8;
      this.configure({ ...this.opts, ...this.scene, rainAmount: this.scene.rain });
    }
    buffer(name, make) {
      if (!this.buffers[name]) { const [sr, chans] = make(), b = this.context.createBuffer(chans.length, chans[0].length, sr); chans.forEach((d, i) => b.copyToChannel(d, i)); this.buffers[name] = b; }
      return this.buffers[name];
    }
    loopBuffer(name) {
      const sr = name.startsWith('rain') ? 32000 : 22050;
      return this.buffer(name, () => [sr, name === 'rainLight' ? AMBIENT_SYNTH.rain(sr, .25) : name === 'rainHeavy' ? AMBIENT_SYNTH.rain(sr, 1) : AMBIENT_SYNTH[name](sr)]);
    }
    // Fade each loop toward its target level; loops that fall silent are stopped.
    refresh() {
      const ctx = this.context, now = ctx.currentTime, want = {};
      if (this.active) { want[this.opts.waterType === 'bamboo' ? 'trickle' : this.opts.waterType] = { level: 1, bus: this.waterBus }; for (const [k, v] of Object.entries(weatherLayers(this.scene))) want[k] = { level: v, bus: this.weatherBus }; }
      for (const name of new Set([...Object.keys(this.layers), ...Object.keys(want)])) {
        let layer = this.layers[name];
        if (!layer && want[name]) {
          const src = ctx.createBufferSource(), gain = ctx.createGain(); src.buffer = this.loopBuffer(name); src.loop = true; gain.gain.value = 0;
          src.connect(gain).connect(want[name].bus); src.start(now, Math.random() * src.buffer.duration); layer = this.layers[name] = { src, gain };
        }
        if (!layer) continue;
        const level = want[name] ? want[name].level : 0; layer.gain.gain.cancelScheduledValues(now); layer.gain.gain.setTargetAtTime(level, now, 1.2);
        if (!level) { const l = layer; delete this.layers[name]; setTimeout(() => { try { l.src.stop(); } catch {} }, 6000); }
      }
      clearInterval(this.timer); this.timer = 0;
      if (this.active) { this.next = Math.max(this.next, now + 1.5); this.phrase = 0; this.timer = setInterval(() => { this.schedule(); this.weatherEvents(); this.waterEvents(); }, 250); }
    }
    play(buf, when, gain, rate = 1, pan = 0, bus = this.musicBus) {
      const ctx = this.context, src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain;
      if (p) { p.pan.value = pan; src.connect(g).connect(p).connect(bus); } else src.connect(g).connect(bus);
      src.start(when); return src;
    }
    // Look-ahead scheduler for the sparse instrument lines.
    schedule() {
      const ctx = this.context; if (!ctx || ctx.state !== 'running' || this.opts.music === 'off') return;
      if (this.next < ctx.currentTime - .5) this.next = ctx.currentTime + rand(.5, 2);
      while (this.next < ctx.currentTime + 1.2) {
        const t = this.next, m = this.opts.music;
        if (m === 'guqin') this.guqin(t);
        else if (m === 'bowl') { const i = Math.floor(rand(0, BOWLS.length)); this.play(this.buffer(`bowl${i}`, () => [44100, [struck(44100, BOWLS[i], 16, [[1, 1, 9, .9], [2.71, .45, 5.5, 1.6], [5.2, .2, 3, 2.3], [8.4, .08, 1.8, 3]], .15)]]), t, rand(.7, .95), 1, rand(-.3, .3)); this.next = t + rand(13, 24); }
        else { const strikes = 2 + Math.floor(rand(0, 6)); let s = t; for (let k = 0; k < strikes; k++) { const i = Math.floor(rand(0, TUBES.length)); this.play(this.buffer(`tube${i}`, () => [44100, [struck(44100, TUBES[i], 6, [[1, .9, 3.2, .4], [2.756, .5, 1.8, .9], [5.404, .25, .9, 1.4]], .35)]]), s, rand(.18, .45), 1, rand(-.7, .7)); s += rand(.08, .45); } this.next = s + rand(6, 16); }
      }
    }
    // Pentatonic phrases wandering by small steps, with the odd slide, vibrato or harmonic.
    guqin(t) {
      if (!this.phrase) { this.phrase = 3 + Math.floor(rand(0, 5)); this.degree = Math.floor(rand(2, 8)); }
      this.degree = Math.max(0, Math.min(GUQIN.length - 1, this.degree + [-2, -1, -1, 0, 1, 1, 2][Math.floor(rand(0, 7))]));
      const i = this.degree, note = this.buffer(`qin${i}`, () => [44100, [pluck(44100, GUQIN[i], 5)]]), roll = Math.random();
      if (roll < .12) {
        // Harmonic (泛音): a clear bell tone an octave or two above.
        const ctx = this.context, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = GUQIN[i] * (Math.random() < .5 ? 2 : 4); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + 2.6);
        o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 2.7);
      } else {
        const src = this.play(note, t, rand(.5, .85), 1, rand(-.25, .25));
        if (roll > .8 && i > 0) { src.playbackRate.setValueAtTime(GUQIN[i - 1] / GUQIN[i], t); src.playbackRate.linearRampToValueAtTime(1, t + .28); }
        else if (roll > .65) { for (let k = 0; k < 6; k++) src.playbackRate.setValueAtTime(1 + (k % 2 ? .006 : -.006), t + .35 + k * .16); src.playbackRate.setValueAtTime(1, t + 1.3); }
      }
      this.phrase--;
      this.next = t + (this.phrase ? (Math.random() < .15 ? .18 : rand(.5, 1.4)) : rand(4.5, 10));
    }
    // Live sounds of the weather: raindrops falling into the pond, birds by day, frogs by night.
    // Thunder is not scheduled here: it follows the lightning the pond draws (see thunderAfter).
    weatherEvents() {
      const ctx = this.context; if (!ctx || ctx.state !== 'running' || !this.opts.weatherSound) return;
      const now = ctx.currentTime, { weather, night, rain } = this.scene, e = this.events, due = (k, gap) => { if (!(e[k] > now - 1)) e[k] = now + gap(); return e[k] < now + .5; };
      if (weather === 'rain') {
        while (due('drop', () => rand(0, .3))) { this.raindrop(e.drop); e.drop += -Math.log(1 - Math.random()) / (2 + 14 * rain); }
      } else if (weather === 'snow') {
        if (due('crow', () => rand(6, 18))) { this.crow(e.crow); e.crow += rand(25, 60); }
      } else if (night) {
        if (due('frog', () => rand(1, 5))) { this.frog(e.frog); e.frog += rand(3, 11); }
      } else {
        if (due('bird', () => rand(1, 4))) { this.bird(e.bird); e.bird += weather === 'sunny' ? rand(3, 9) : rand(9, 22); }
        if (weather === 'sunny' && due('dove', () => rand(8, 20))) { this.dove(e.dove); e.dove += rand(22, 45); }
        if (weather === 'cloudy' && due('cuckoo', () => rand(6, 16))) { this.cuckoo(e.cuckoo); e.cuckoo += rand(20, 40); }
      }
    }
    // The bamboo spout fills, tips and knocks on its stone (shishi-odoshi), spilling its water.
    waterEvents() {
      const ctx = this.context; if (!ctx || ctx.state !== 'running' || !this.opts.water || this.opts.waterType !== 'bamboo') return;
      const now = ctx.currentTime, e = this.events;
      if (!(e.knock > now - 1)) e.knock = now + rand(3, 8);
      if (e.knock < now + .5) { this.knock(e.knock); e.knock += rand(16, 30); }
    }
    knock(t) {
      this.tone(t, 520, 470, .16, .32, .15, this.waterBus, 'sine', .001); this.tone(t, 1380, 1250, .06, .12, .15, this.waterBus, 'triangle', .001);
      this.tone(t + .55, 560, 500, .1, .1, .15, this.waterBus, 'sine', .001);
      const ctx = this.context, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.buffer('pour', () => [22050, [band(noise(22050), 400, 3200, 22050)]]); f.type = 'lowpass'; f.frequency.value = 2600;
      g.gain.setValueAtTime(0, t + .03); g.gain.linearRampToValueAtTime(.35, t + .08); g.gain.exponentialRampToValueAtTime(.001, t + .9);
      src.connect(f).connect(g).connect(this.waterBus); src.start(t + .03); src.stop(t + 1);
      for (let k = 0; k < 5; k++) { const f0 = rand(500, 1100); this.tone(t + .1 + k * rand(.05, .12), f0, f0 * 1.8, .06, .1, rand(-.2, .4), this.waterBus, 'sine', .002); }
    }
    // A cuckoo far off on a grey day: 布谷, 布谷.
    cuckoo(t) { const f = rand(620, 700), pan = rand(-.8, .8); for (let k = 0; k < 2 + Math.floor(rand(0, 2)); k++) { this.tone(t + k * .9, f, f * .97, .28, .06, pan, this.weatherBus, 'sine', .03); this.tone(t + k * .9 + .32, f * .8, f * .77, .36, .055, pan, this.weatherBus, 'sine', .03); } }
    // Crows calling across a snowy field.
    crow(t) {
      const ctx = this.context, pan = rand(-.8, .8);
      for (let k = 0; k < 2 + Math.floor(rand(0, 2)); k++) {
        const s = t + k * rand(.45, .7), o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner(), f = rand(420, 520);
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f, s); o.frequency.linearRampToValueAtTime(f * .8, s + .3); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.6; p.pan.value = pan;
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.05, s + .04); g.gain.exponentialRampToValueAtTime(.001, s + .34);
        o.connect(bp).connect(g).connect(p).connect(this.weatherBus); o.start(s); o.stop(s + .36);
      }
    }
    tone(t, f0, f1, dur, gain, pan, bus = this.weatherBus, type = 'sine', attack = .008) {
      const ctx = this.context, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(.0003, t + dur);
      p.pan.value = pan; o.connect(g).connect(p).connect(bus); o.start(t); o.stop(t + dur + .02);
    }
    raindrop(t) { const f = rand(650, 1700); this.tone(t, f, f * rand(1.5, 2.3), rand(.035, .07), rand(.03, .09) * (.6 + .5 * this.scene.rain), rand(-.9, .9), this.weatherBus, 'sine', .002); }
    // Thunder rolling in `delay` seconds after a flash of lightning seen over the pond.
    thunderAfter(delay, strength = 1) {
      const ctx = this.context; if (!ctx || ctx.state !== 'running' || !this.active || !this.opts.weatherSound) return;
      this.thunder(ctx.currentTime + delay, strength);
    }
    thunder(t, strength = 1) {
      const ctx = this.context, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.buffer('rumble', () => { const sr = 11025, d = noise(sr * 7); let y = 0; for (let i = 0; i < d.length; i++) { y = y * .985 + d[i] * .15; d[i] = y; } return [sr, [d]]; });
      f.type = 'lowpass'; f.frequency.value = 160; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.55 * (.6 + .4 * strength), t + rand(.8, 2)); g.gain.exponentialRampToValueAtTime(.001, t + 6.5);
      src.connect(f).connect(g).connect(this.weatherBus); src.start(t); src.stop(t + 7);
    }
    // Songbirds: a run of rising chirps, a two-note whistle or a quick trill, somewhere in the trees.
    bird(t) {
      const kind = Math.floor(rand(0, 3)), pan = rand(-.85, .85), gain = rand(.03, .07);
      if (kind === 0) { const f = rand(3200, 4300); let s = t; for (let k = 3 + Math.floor(rand(0, 4)); k > 0; k--) { this.tone(s, f * rand(.92, 1.06), f * rand(1.2, 1.38), rand(.05, .08), gain, pan); s += rand(.09, .15); } }
      else if (kind === 1) { const f = rand(1700, 2300); this.tone(t, f, f * 1.12, .22, gain * 1.2, pan); this.tone(t + .29, f * 1.22, f * .95, .3, gain * 1.2, pan); }
      else { const f = rand(4300, 5300); for (let k = 0; k < 10; k++) this.tone(t + k * .045, f, f * .84, .035, gain * .8, pan); }
    }
    // A turtle dove somewhere off: coo, COO, coo-coo.
    dove(t) { const f = rand(390, 450), pan = rand(-.7, .7); for (const [dt, len, amp] of [[0, .32, .6], [.44, .5, 1], [1.05, .33, .6], [1.46, .36, .5]]) this.tone(t + dt, f * 1.05, f * .86, len, .05 * amp, pan, this.weatherBus, 'sine', .07); }
    // A frog: a burst of buzzy pulses through a throat-like resonance, sometimes answered twice.
    frog(t) {
      const ctx = this.context, f = rand(170, 300), rate = rand(18, 28), pan = rand(-.85, .85), gain = rand(.05, .09);
      for (let rep = 0, s = t; rep < 1 + Math.floor(rand(0, 3)); rep++, s += rand(.5, .9)) {
        const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner(), pulses = 5 + Math.floor(rand(0, 6));
        o.type = 'sawtooth'; o.frequency.value = f; bp.type = 'bandpass'; bp.frequency.value = f * 3.2; bp.Q.value = 3; p.pan.value = pan; g.gain.value = 0;
        for (let k = 0; k < pulses; k++) { const a = s + k / rate; g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(gain, a + .006); g.gain.linearRampToValueAtTime(0, a + .75 / rate); }
        o.connect(bp).connect(g).connect(p).connect(this.weatherBus); o.start(s); o.stop(s + pulses / rate + .05);
      }
    }
    async toggle() {
      if (!this.context) this.setup();
      this.active = !this.active;
      if (this.active) await this.context.resume();
      this.refresh();
      if (!this.active) setTimeout(() => { if (!this.active) this.context.suspend(); }, 2500);
      return this.active;
    }
    ok() { return this.context && this.context.state === 'running' && this.active && this.opts.sfx; }
    // Food scattering on the surface: a few small drops with a hiss of spray.
    plop() {
      if (!this.ok()) return;
      const ctx = this.context, now = ctx.currentTime;
      for (let k = 0; k < 4; k++) this.drop(now + k * rand(.015, .05), rand(700, 1300), rand(.12, .22), rand(-.4, .4));
      const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      n.buffer = this.buffer('spray', () => [22050, [band(noise(4410), 1800, 6000, 22050)]]); f.type = 'highpass'; f.frequency.value = 1500;
      g.gain.setValueAtTime(.05, now); g.gain.exponentialRampToValueAtTime(.001, now + .15); n.connect(f).connect(g).connect(this.sfxBus); n.start(now); n.stop(now + .2);
    }
    // A koi taking a pellet: a low, round pop.
    gulp() { if (this.ok()) this.drop(this.context.currentTime, rand(260, 380), .16, rand(-.3, .3), .5); }
    // A fingertip touching the water.
    tap() { if (this.ok()) this.drop(this.context.currentTime, rand(520, 700), .2, 0, 1.2); }
    drop(t, f, gain, pan, rise = .9) { this.tone(t, f, f * (1 + rise), Math.min(.12, 22 / f + .02) * 1.6, gain, pan, this.sfxBus, 'sine', .002); }
  }
  root.PondAudio = { PondAudio, MUSIC, WATERS };
})(window);
