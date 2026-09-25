// Procedural sprites: koi, fins, turtles, butterflies and small props, painted once into canvases.
(function (root) {
  'use strict';
  const { BODY, randomSeed, fishPalette } = root.PondCore;
  const TAU = Math.PI * 2;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

  function valueNoise(seed) {
    const r = randomSeed(seed * 7919 + 17), perm = new Uint8Array(512), vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const X = xi & 255, Y = yi & 255, a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]], c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function fbm(n, x, y, oct = 4) { let s = 0, a = .5, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); t += a; a *= .5; f *= 2.03; } return s / t; }

  // ---------- Koi ----------
  const girthOf = seed => .93 + randomSeed(seed + 3)() * .14;
  // Half the body's width seen from above, at body x (nose +34 → tail root). A koi's head is a rounded wedge,
  // clearly narrower than the body; the body swells to its widest over the pectoral fins and front of the
  // dorsal fin (about two fifths back), then tapers to a thick tail stalk.
  function halfWidth(x, girth, kind) {
    const silver = kind === 'silvercarp', len = silver ? 70 : 64, t = (BODY.nose - x) / len;
    if (t < 0 || t > 1) return 0;
    const peak = silver ? .32 : .42, W = (silver ? 7.2 : 9.4) * girth;
    const end = t > .92 ? Math.sqrt(Math.max(0, 1 - ((t - .92) / .08) ** 2)) : 1;
    // In front of the widest point the outline is a long half-ellipse: a blunt, round snout, never a point.
    if (t < peak) { const s = t / peak; return W * Math.pow(1 - (1 - s) * (1 - s), .55) * end; }
    return W * (1 - (silver ? .74 : .62) * Math.pow((t - peak) / (1 - peak), silver ? 1.25 : 1.5)) * end;
  }
  const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  // Overlapping scales laid on the round back: rows follow arc length across the body, so they squeeze toward
  // the flanks. The visible scale is the most forward one covering the point (free edges point to the tail).
  // Writes into SC: r = distance from its centre (1 = free edge), id, its centre in body coordinates, and
  // dx = how far forward of its centre the point lies (−1 tail side … +1 head side, where it tucks under its neighbour).
  const SC = { r: 2, id: 0, x: 0, y: 0, dx: 0 };
  function scaleAt(x, y, w, size = 1) {
    const ys = Math.asin(Math.max(-.999, Math.min(.999, y / w))) * w, sx = 1.85 * size, sy = 1.55 * size, R = sx * .74, row = Math.round(ys / sy);
    let best = -1e9; SC.r = 2;
    for (let rr = row - 1; rr <= row + 1; rr++) {
      const cy = rr * sy, off = (rr & 1) ? sx * .5 : 0, col = Math.round((x - off) / sx);
      for (let cc = col - 1; cc <= col + 1; cc++) {
        // Real scales are not a perfect lattice: each sits a little off its neighbours.
        const cx = cc * sx + off + (hash(rr * 13.1 + cc * 7.7) - .5) * sx * .22, d = Math.hypot(x - cx, ys - cy - (hash(rr * 5.3 - cc * 11.9) - .5) * sy * .18);
        if (d < R && cx > best) { best = cx; SC.r = d / R; SC.id = rr * 997 + cc; SC.x = cx; SC.dx = (x - cx) / R; SC.y = Math.sin(Math.max(-1.5, Math.min(1.5, cy / w))) * w; }
      }
    }
    return SC.r <= 1;
  }
  // Raw pattern fields, positive inside a patch: out[0] red (hi), out[1] black (sumi).
  function patternFor(kind, seed) {
    const r = randomSeed(seed + 11), n = valueNoise(seed), n2 = valueNoise(seed + 101);
    const ox = r() * 50, oy = r() * 50, th = .5 + (r() - .5) * .12 + (kind === 'sanke' ? .03 : 0), headRed = r() < .75, band = r() * TAU, split = r() < .5 ? -1 : 1;
    const tx = 23.5 + r() * 1.5, tr = 5.6 + r() * 1.1;
    return (x, y, w, out) => {
      const v = Math.max(-1, Math.min(1, y / Math.max(w, .5)));
      out[0] = -1; out[1] = -1;
      if (kind === 'kohaku' || kind === 'sanke') {
        let val = fbm(n, x * .075 + ox, v * 1.05 + oy) + .14 * Math.sin(x * .16 + band);
        if (headRed) val += .2 * smooth(17, 25, x);
        out[0] = val - th - .6 * smooth(30.5, 33.5, x) - .08 * smooth(.7, 1, Math.abs(v));
        if (kind === 'sanke') out[1] = fbm(n2, x * .2 + ox, v * 1.8 + oy, 3) - .72 - .3 * smooth(13, 19, x);
      } else if (kind === 'utsuri') {
        const val = fbm(n, x * .06 + ox, v * .9 + oy) + .12 * Math.sin(x * .13 + band) + .35 * smooth(17, 21, x) * smooth(-.15, .15, split * v + (x - 26) * .12);
        out[1] = val - th - .04;
      } else if (kind === 'tancho') out[0] = (tr - Math.hypot(x - tx, y) - (n(x * .5 + ox, y * .5 + oy) - .5) * 1.4) * .06;
    };
  }
  // Heavy per-pixel layers, cached per palette/seed/resolution; marks are composited on top cheaply.
  const layerCache = new Map();
  function fishLayers(palette, seed, ppu, species) {
    const key = `${species || 'koi'}:${palette}:${seed}:${ppu}`;
    if (layerCache.has(key)) return layerCache.get(key);
    const pal = fishPalette({ palette, species }), kind = pal.kind, girth = girthOf(seed), pattern = patternFor(kind, seed), grain = valueNoise(seed + 7);
    const W = Math.round(BODY.width * ppu), H = Math.round(BODY.half * 2 * ppu), N = W * H;
    const albedo = new ImageData(W, H), shade = new Float32Array(N), spec = new Float32Array(N), fin = new ImageData(W, H);
    const base = hex(pal.base), hiC = hex(pal.spot), sumiC = hex(pal.second || pal.spot), finC = hex(pal.fin);
    // Hi is deepest in the middle of a patch and turns orange toward its edges.
    const hiDeep = hiC.map(c => c * .86), hiEdge = hiC.map((c, i) => mix(c, [238, 128, 74][i], .35));
    const metal = kind === 'ogon', dark = kind === 'karasu', silver = kind === 'silvercarp', red = kind === 'benigoi', patterned = ['kohaku', 'sanke', 'utsuri', 'tancho'].includes(kind);
    const P = [0, 0], Q = [0, 0], T = [0, 0], ped = [0, 0];
    pattern(-26, 0, 3, ped);
    for (let py = 0; py < H; py++) {
      const y = (py + .5) / ppu - BODY.half;
      for (let px = 0; px < W; px++) {
        const x = (px + .5) / ppu + BODY.left, i = py * W + px, j = i * 4, w = halfWidth(x, girth, kind), ay = Math.abs(y);
        if (w > 0) {
          const cov = clamp01((w - ay) * ppu + .5);
          if (cov > 0) {
            const v = Math.max(-1, Math.min(1, y / w)), nz = Math.sqrt(Math.max(0, 1 - v * v)), g = .96 + .08 * fbm(grain, x * .35, y * .35, 2);
            // Scales cover the body from behind the gill covers to the tail stalk; the silver carp's are small and fine.
            const scaleZone = smooth(silver ? 13 : 17, silver ? 9 : 13, x) * smooth(silver ? -37 : -30, silver ? -32 : -25, x) * smooth(.99, .86, Math.abs(v)), onScale = scaleZone > 0 && scaleAt(x, y, w, silver ? .62 : 1);
            // Broad, soft variations in tone, so no colour is ever perfectly flat.
            const mottle = .94 + .12 * fbm(grain, x * .09 + 40, y * .14, 3);
            let c0, c1, c2, hi = 0, sumi = 0;
            if (metal) {
              // Yamabuki ogon: warm gold along the back, deeper amber on the flanks, a softer sheen on the head.
              const k = Math.pow(nz, 1.4);
              c0 = mix(166, 228, k); c1 = mix(104, 172, k); c2 = mix(22, 52, k);
              const head = smooth(18, 28, x) * k; c0 = mix(c0, 234, head * .3); c1 = mix(c1, 184, head * .3); c2 = mix(c2, 84, head * .3);
            } else if (silver) {
              // A deep blue-green dorsal stripe fades through silver into white belly edges.
              // The belly is seen along both flanks in this overhead view.
              // Silver carp: a broad dark blue-green-grey back (the 青 of its name) fading through bright silver
              // to the white belly, which shows along both edges from above.
              const flank = smooth(.22, .72, Math.abs(v)), belly = smooth(.6, .88, Math.abs(v)), head = smooth(10, 22, x) * (1 - flank) * .25;
              c0 = mix(mix(34 - head * 12, 200, flank), 244, belly);
              c1 = mix(mix(72 - head * 20, 212, flank), 247, belly);
              c2 = mix(mix(70 - head * 18, 210, flank), 241, belly);
            } else {
              c0 = base[0]; c1 = base[1]; c2 = base[2];
              if (dark) { const side = smooth(.62, 1, Math.abs(v)) * .5; c0 = mix(c0, 92, side); c1 = mix(c1, 104, side); c2 = mix(c2, 100, side); }
              else if (red) {
                // Beni: a deep crimson ridge along the back that warms to scarlet and orange down the flanks; the head is a little lighter.
                const flank = smooth(.15, .95, Math.abs(v)), head = smooth(16, 24, x);
                c0 = mix(mix(176, 222, flank), 214, head * .5); c1 = mix(mix(34, 70, flank), 66, head * .5); c2 = mix(mix(26, 42, flank), 44, head * .5);
              }
              else if (!red) { const flank = smooth(.7, 1, Math.abs(v)) * .3 + smooth(29, 33, x) * .3; c0 = mix(c0, 236, flank); c1 = mix(c1, 214, flank); c2 = mix(c2, 202, flank); }
            }
            if (patterned) {
              pattern(x, y, w, P);
              if (onScale) pattern(SC.x, SC.y, w, Q); else { Q[0] = P[0]; Q[1] = P[1]; }
              // The tail-side edge of a patch (kiwa) follows scale outlines; the head-side edge (sashi) is soft,
              // seen through the white scales overlapping it.
              pattern(x + .9, y, w, T);
              const sashi = smooth(0, .025, P[0] - T[0]);
              hi = mix(smooth(-.012, .012, Q[0]), smooth(-.05, .04, P[0]), onScale ? sashi : 1);
              sumi = mix(smooth(-.012, .012, Q[1]), smooth(-.025, .025, P[1]), onScale ? .3 : 1);
              const edge = 1 - smooth(0, .12, P[0]), hc0 = mix(hiDeep[0], hiEdge[0], edge), hc1 = mix(hiDeep[1], hiEdge[1], edge), hc2 = mix(hiDeep[2], hiEdge[2], edge);
              const pale = sashi * (1 - smooth(0, .05, P[0])) * .35;
              c0 = mix(c0, mix(hc0, c0, pale), hi); c1 = mix(c1, mix(hc1, c1, pale), hi); c2 = mix(c2, mix(hc2, c2, pale), hi);
              c0 = mix(c0, sumiC[0], sumi); c1 = mix(c1, sumiC[1], sumi); c2 = mix(c2, sumiC[2], sumi);
            }
            // Each scale carries its own slight tone, which is how scales read from a distance.
            // Each scale carries its own slight tone, which is how scales read from a distance.
            if (onScale) { const tone = 1 + (hash(SC.id + seed) - .5) * (metal ? .1 : red || dark ? .09 : silver ? .1 : .05) * scaleZone; c0 *= tone; c1 *= tone; c2 *= tone; }
            const mot = silver ? mix(mottle, 1, smooth(.55, .85, Math.abs(v))) : mottle;
            c0 *= mot; c1 *= mot; c2 *= mot;
            // The visible part of every scale: its front tucks under the scale ahead and lies in that scale's shadow
            // (the pocket), a band just inside the free rear edge catches the light, and the edge itself is a fine dark line.
            if (onScale) {
              const back = smooth(.1, -.5, SC.dx), pocket = smooth(-.35, .75, SC.dx) * (1 - smooth(.86, 1, SC.r)) * scaleZone;
              const line = smooth(.84, .98, SC.r) * back * scaleZone, margin = smooth(.5, .78, SC.r) * (1 - smooth(.84, .95, SC.r)) * back * scaleZone;
              const inRed = patterned ? hi : red ? 1 : 0, inBlack = dark ? 1 : patterned ? sumi : 0;
              let pd, ld, mg, tint;
              if (metal) { pd = .16; ld = .1; mg = .15; tint = [255, 226, 150]; }
              else if (silver) { const b = 1 - smooth(.55, .85, Math.abs(v)) * .8; pd = .12 * b; ld = .12 * b; mg = .2; tint = [236, 246, 248]; }
              else if (inBlack > .5) { pd = .22; ld = -.28; mg = .24; tint = [120, 130, 128]; }  // karasu: pale net over black pockets
              else if (inRed > .5) { pd = .16; ld = .16; mg = .14; tint = [240, 120, 76]; }
              else { pd = .05; ld = .11; mg = .1; tint = [255, 253, 246]; }                        // white skin: a faint grey net
              const k = 1 - pocket * pd - line * ld;
              c0 = mix(c0 * k, tint[0], margin * mg); c1 = mix(c1 * k, tint[1], margin * mg); c2 = mix(c2 * k, tint[2], margin * mg);
            }
            // Dorsal fin folded along the back: a dark spine line with a faint translucent membrane beside it.
            const along = smooth(-23, -17, x) * smooth(10, 5, x), core = smooth(.6, .1, ay) * along * .2, mem = smooth(1.7, .6, ay) * along * (.6 + .4 * Math.sin(x * 3.4)) * .1;
            c0 = mix(mix(c0, finC[0], mem), c0 * .62, core); c1 = mix(mix(c1, finC[1], mem), c1 * .64, core); c2 = mix(mix(c2, finC[2], mem), c2 * .66, core);
            albedo.data[j] = c0 * g; albedo.data[j + 1] = c1 * g; albedo.data[j + 2] = c2 * g; albedo.data[j + 3] = cov * 255;
            let sh = (metal ? .64 + .36 * Math.pow(nz, .55) : .64 + .36 * Math.pow(nz, .6)) * (1 - .24 * smooth(.72, 1, Math.abs(v)));
            if (silver) sh = .88 + .12 * nz;
            let sp = metal ? .04 * Math.pow(nz, 3) + .05 * Math.pow(nz, 12) : (dark ? .035 : .07) * Math.pow(nz, 6);
            if (onScale) {
              // The light-catching band inside each free edge, stronger on the metallic and silver fish;
              // now and then a single scale is turned just so and flashes.
              const back = smooth(.1, -.5, SC.dx), band = smooth(.5, .76, SC.r) * (1 - smooth(.82, .92, SC.r)) * back * scaleZone;
              const flash = hash(SC.id * 3.1 + seed) > (metal || silver ? .9 : .96) ? (1 - SC.r) * scaleZone : 0;
              if (metal) sp += band * .09 + flash * .07;
              else if (silver) sp += band * .08 + flash * .09;
              else if (dark) sp += band * .03 + flash * .02;
              else sp += band * .045 + flash * .025;
            }
            sp += smooth(17, 25, x) * Math.pow(nz, 4) * (metal ? .045 : dark ? .025 : .045);
            shade[i] = sh; spec[i] = sp;
          }
        }
        // Tail fin: forked, translucent, fine rays fanning from the peduncle.
        const tailRoot = silver ? -32 : -23;
        if (x < tailRoot && x > -57.5) {
          const tailU = clamp01(((silver ? -34 : -26) - x) / (silver ? 22 : 26));
          const span = (silver ? 1.7 : 3.2) + (silver ? 8 : 9.4) * Math.pow(tailU, .85), wob = (grain(x * .5, y * .5) - .5) * (silver ? .45 : 1.2);
          const endX = (silver ? -43 : -47) - (silver ? 13 : 9) * Math.pow(Math.min(1, ay / (silver ? 9.3 : 11.5)), 1.6) + wob, edge = Math.min(span - ay, x - endX, tailRoot - x);
          if (edge > -.6) {
            const th = Math.atan2(y, -(x - tailRoot + 1)), ray = Math.pow(.5 + .5 * Math.cos(th * 26), 6), fold = .5 + .5 * Math.sin(th * 9 + grain(x * .2, 3) * 4);
            const a = clamp01((edge + .6) / 1.4) * (mix(.8, .34, silver ? tailU : clamp01((-27 - x) / 26)) + ray * .16 - fold * .1);
            const base2 = clamp01(1 - ((silver ? -34 : -26) - x) / 7), pedHi = ped[0] > 0 ? 1 : 0, pedSumi = ped[1] > 0;
            let f0 = finC[0], f1 = finC[1], f2 = finC[2];
            f0 = mix(f0, mix(base[0], hiC[0], pedHi), base2 * .8); f1 = mix(f1, mix(base[1], hiC[1], pedHi), base2 * .8); f2 = mix(f2, mix(base[2], hiC[2], pedHi), base2 * .8);
            if (pedSumi) { f0 = mix(f0, sumiC[0], base2 * .7); f1 = mix(f1, sumiC[1], base2 * .7); f2 = mix(f2, sumiC[2], base2 * .7); }
            const lift = ray * (metal ? 26 : 22);
            fin.data[j] = Math.min(255, f0 + lift); fin.data[j + 1] = Math.min(255, f1 + lift); fin.data[j + 2] = Math.min(255, f2 + lift * (metal ? .6 : 1)); fin.data[j + 3] = clamp01(a) * 255;
          }
        }
      }
    }
    const layers = { W, H, ppu, girth, albedo, shade, spec, fin, kind, pal };
    if (layerCache.size > 90) layerCache.delete(layerCache.keys().next().value);
    layerCache.set(key, layers);
    return layers;
  }
  function fishSprite(f, ppu = 3.5, out) {
    const L = fishLayers(f.palette, f.seed, ppu, f.species), { W, H } = L;
    const c = out && out.width === W && out.height === H ? out : canvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, W, H);
    let alb = L.albedo.data;
    if (f.marks && f.marks.length) {
      ctx.putImageData(L.albedo, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      for (const m of f.marks) { ctx.beginPath(); ctx.arc((m.x - BODY.left) * ppu, (m.y + BODY.half) * ppu, m.r * ppu, 0, TAU); ctx.fillStyle = m.color; ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
      alb = ctx.getImageData(0, 0, W, H).data;
    }
    const out2 = ctx.createImageData(W, H), o = out2.data, fin = L.fin.data;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const ba = alb[j + 3] / 255, fa = fin[j + 3] / 255, a = ba + fa * (1 - ba);
      if (a <= 0) continue;
      const sh = L.shade[i], sp = L.spec[i] * 255, k = fa * (1 - ba);
      o[j] = (Math.min(255, alb[j] * sh + sp) * ba + fin[j] * k) / a;
      o[j + 1] = (Math.min(255, alb[j + 1] * sh + sp) * ba + fin[j + 1] * k) / a;
      o[j + 2] = (Math.min(255, alb[j + 2] * sh + sp * .96) * ba + fin[j + 2] * k) / a;
      o[j + 3] = a * 255;
    }
    ctx.putImageData(out2, 0, 0);
    // Details: gill covers, nostrils, barbels, a glossy head and the eyes.
    ctx.save(); ctx.scale(ppu, ppu); ctx.translate(-BODY.left, BODY.half);
    const dark = L.kind === 'karasu', ink = dark ? 'rgba(200,210,205,' : 'rgba(40,52,46,';
    ctx.globalCompositeOperation = 'source-atop';
    const hg = ctx.createRadialGradient(27, 0, 0, 27, 0, 7); hg.addColorStop(0, 'rgba(255,255,250,.16)'); hg.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = hg; ctx.fillRect(18, -9, 18, 18);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const w1 = halfWidth(18.6, L.girth, L.kind), w2 = halfWidth(16.2, L.girth, L.kind);
      ctx.beginPath(); ctx.moveTo(18.8, s * w1 * .42); ctx.quadraticCurveTo(18.2, s * w1 * .85, 16.2, s * w2 * .99);
      ctx.strokeStyle = ink + '.16)'; ctx.lineWidth = .55; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(30.6, s * 2.1, .55, .4, 0, 0, TAU); ctx.fillStyle = ink + '.34)'; ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of [-1, 1]) {
      if (L.kind !== 'silvercarp') {
      ctx.beginPath(); ctx.moveTo(32.6, s * 1.9); ctx.quadraticCurveTo(34, s * 2.3, 34.7, s * 3.5);
      ctx.strokeStyle = dark ? 'rgba(60,70,66,.55)' : 'rgba(214,196,168,.55)'; ctx.lineWidth = .38; ctx.stroke();
      }
      const ex = L.kind === 'silvercarp' ? 23.8 : 25.8, ey = s * (halfWidth(ex, L.girth, L.kind) - 1.25);
      const ring = ctx.createRadialGradient(ex, ey, .15, ex, ey, 1.45);
      ring.addColorStop(0, '#0f1413'); ring.addColorStop(.5, '#1a201e'); ring.addColorStop(.62, L.kind === 'ogon' ? '#d9bf78' : dark ? '#6d7262' : '#b8aa7e'); ring.addColorStop(.85, 'rgba(120,110,90,.35)'); ring.addColorStop(1, 'rgba(120,110,90,0)');
      ctx.beginPath(); ctx.arc(ex, ey, 1.45, 0, TAU); ctx.fillStyle = ring; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + .3, ey - .22, .26, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fill();
    }
    ctx.restore();
    return c;
  }
  // Pectoral fin, pivot at the left middle; white so it can be tinted per palette.
  function finSprite(ppu = 4, motoguro = false) {
    const c = canvas(21 * ppu, 14 * ppu), ctx = c.getContext('2d');
    ctx.scale(ppu, ppu); ctx.translate(1, 7);
    const path = new Path2D(); path.moveTo(0, -1.7); path.bezierCurveTo(5, -4, 12, -6.3, 15.8, -4.3); path.bezierCurveTo(18.2, -2.4, 18, 3, 15.2, 4.7); path.bezierCurveTo(10.6, 6.6, 4.6, 4.4, 0, 1.7); path.closePath();
    const g = ctx.createLinearGradient(0, 0, 18, 0); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.6, 'rgba(255,255,255,.68)'); g.addColorStop(1, 'rgba(255,255,255,.42)');
    ctx.fillStyle = g; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    if (motoguro) { const m = ctx.createLinearGradient(0, 0, 11, 0); m.addColorStop(0, 'rgba(24,32,31,.95)'); m.addColorStop(.55, 'rgba(24,32,31,.8)'); m.addColorStop(1, 'rgba(24,32,31,0)'); ctx.fillStyle = m; ctx.fillRect(0, -8, 12, 16); }
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 11; k++) { const a = -.5 + k * .1 + .05; ctx.beginPath(); ctx.moveTo(.5, 0); ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = .7; ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 12; k++) { const a = -.5 + k * .1; ctx.beginPath(); ctx.moveTo(.5, 0); ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); ctx.strokeStyle = motoguro && k % 2 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.5)'; ctx.lineWidth = .28; ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = .35; ctx.stroke(path);
    return { canvas: c, ppu, px: 1 / 21, py: .5 };
  }

  // ---------- Turtle ----------
  const TURTLES = [
    { shell: '#56663a', light: '#7d8a4c', seam: '#2c341f', line: '#cdbb66', skin: '#546238', stripe: '#d3c97a', ear: '#c0482e', plastron: '#c9b56a' },
    { shell: '#4f4a33', light: '#75694a', seam: '#2a261a', line: '#9f9460', skin: '#56594a', stripe: '#b9b98a', ear: null, plastron: '#b39c62' }
  ];
  function shellSprite(v, ppu) {
    const T = TURTLES[v], W = 50, H = 42, c = canvas(W * ppu, H * ppu), ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height), d = img.data, n = valueNoise(v * 31 + 5);
    const base = hex(T.shell), light = hex(T.light), seam = hex(T.seam), line = hex(T.line);
    const centers = [[14.5, 0], [7.2, 0], [0, 0], [-7.2, 0], [-14.2, 0]];
    for (const x of [10.5, 3.5, -3.5, -10.5]) { centers.push([x, 10.8], [x, -10.8]); }
    for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
      const x = (px + .5) / ppu - W / 2, y = (py + .5) / ppu - H / 2, rx = 22 * (1 + (x < 0 ? .02 : 0)), ry = 17.6 * (1 + (x < 0 ? -x / rx * .07 : 0));
      const th = Math.atan2(y / ry, x / rx), serr = Math.abs(Math.cos(th)) > .5 && x < 0 ? .35 * Math.abs(Math.sin(th * 12)) : 0;
      const rr = Math.hypot(x / rx, y / ry), edge = (1 - rr) * Math.min(rx, ry) + serr;
      if (edge < -.8) continue;
      const cov = clamp01((edge + .5) * ppu * .6), j = (py * c.width + px) * 4;
      let d1 = 1e9, d2 = 1e9, ci = 0;
      for (let k = 0; k < centers.length; k++) { const dx = (x - centers[k][0]) * 1.05, dy = y - centers[k][1], dd = Math.hypot(dx, dy); if (dd < d1) { d2 = d1; d1 = dd; ci = k; } else if (dd < d2) d2 = dd; }
      const marginal = rr > .82;
      let s = marginal ? 1 - smooth(0, .09, Math.abs(Math.sin(th * 12 + .26))) : 1 - smooth(.25, .75, d2 - d1);
      if (marginal) s = Math.max(s, 1 - smooth(0, .02, Math.abs(rr - .82) * 4));
      const rings = .5 + .5 * Math.sin((marginal ? (1 - rr) * 70 : (d2 - d1) * 2.2) + n(x * .4, y * .4) * 2);
      const center = marginal ? .4 : clamp01(1 - (d2 - d1) / 6);
      let c0 = mix(base[0], light[0], center * .8), c1 = mix(base[1], light[1], center * .8), c2 = mix(base[2], light[2], center * .8);
      const mot = fbm(n, x * .18, y * .18, 3);
      c0 *= .86 + mot * .26 + rings * .06; c1 *= .86 + mot * .26 + rings * .06; c2 *= .86 + mot * .2 + rings * .05;
      // Yellow radiating marks on the costal scutes; bars on the rim.
      const ang = Math.atan2(y - centers[ci][1], x - centers[ci][0]);
      const mark = !marginal && ci >= 5 ? smooth(.8, .95, Math.sin(ang * 3 + d1 * .55 + ci)) * smooth(1.5, 3.5, d1) * .75 : marginal ? smooth(.6, .9, Math.sin(th * 24 + 1.5)) * .5 : 0;
      c0 = mix(c0, line[0], mark * .55); c1 = mix(c1, line[1], mark * .55); c2 = mix(c2, line[2], mark * .5);
      c0 = mix(c0, seam[0], s * .85); c1 = mix(c1, seam[1], s * .85); c2 = mix(c2, seam[2], s * .85);
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, rr * .96) ** 2)), keel = v === 1 ? smooth(1.2, 0, Math.abs(y)) * .12 + smooth(1.1, 0, Math.abs(Math.abs(y) - 9.5)) * .08 : 0;
      const lit = (.5 + .5 * Math.pow(nz, .6)) * (1 - .3 * smooth(.9, 1.02, rr)) + keel;
      const gloss = Math.pow(nz, 14) * .16 + smooth(.55, .9, fbm(n, x * .5 + 9, y * .5, 2)) * .05;
      d[j] = Math.min(255, c0 * lit + gloss * 255); d[j + 1] = Math.min(255, c1 * lit + gloss * 255); d[j + 2] = Math.min(255, c2 * lit + gloss * 240); d[j + 3] = cov * 255;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: c, ppu, px: .5, py: .5 };
  }
  function skinPaint(ctx, T, path, len, stripes) {
    ctx.fillStyle = T.skin; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    for (let k = 0; k < stripes.length; k++) { ctx.beginPath(); ctx.moveTo(-2, stripes[k]); ctx.bezierCurveTo(len * .3, stripes[k] * 1.15, len * .7, stripes[k] * .75, len + 1, stripes[k] * .35); ctx.strokeStyle = T.stripe; ctx.globalAlpha = .5; ctx.lineWidth = .4; ctx.stroke(); }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, -6, 0, 6); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(.45, 'rgba(255,255,230,.12)'); g.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.fillStyle = g; ctx.fillRect(-3, -8, len + 6, 16);
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,26,16,.35)'; ctx.lineWidth = .3; ctx.stroke(path);
  }
  function turtleSprites(v, ppu = 4) {
    const T = TURTLES[v], parts = { shell: shellSprite(v, ppu) };
    // Head with neck, pivot at the neck root, snout toward +x.
    let c = canvas(19 * ppu, 12 * ppu), ctx = c.getContext('2d'); ctx.scale(ppu, ppu); ctx.translate(1, 6); ctx.scale(1.12, 1.12);
    let p = new Path2D(); p.moveTo(0, -2.6); p.bezierCurveTo(3, -2.9, 6, -4.3, 9.6, -4); p.bezierCurveTo(13, -3.6, 15.2, -1.7, 15.7, 0); p.bezierCurveTo(15.2, 1.7, 13, 3.6, 9.6, 4); p.bezierCurveTo(6, 4.3, 3, 2.9, 0, 2.6); p.closePath();
    skinPaint(ctx, T, p, 16, [-2.3, -.8, .8, 2.3]);
    for (const s of [-1, 1]) {
      if (T.ear) { ctx.beginPath(); ctx.ellipse(8.2, s * 3.1, 1.9, .7, s * .15, 0, TAU); ctx.fillStyle = T.ear; ctx.globalAlpha = .85; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(11.6, s * 2.6, 1.05, 0, TAU); ctx.fillStyle = '#d6c56d'; ctx.fill();
      ctx.beginPath(); ctx.arc(11.7, s * 2.62, .66, 0, TAU); ctx.fillStyle = '#141712'; ctx.fill();
      ctx.beginPath(); ctx.arc(11.9, s * 2.62 - .25, .2, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(15, s * .55, .22, 0, TAU); ctx.fillStyle = 'rgba(20,24,16,.6)'; ctx.fill();
    }
    parts.head = { canvas: c, ppu, px: 1 / 19, py: .5 };
    // Legs point along +x from the shoulder pivot; claws at the tip.
    const leg = (len, wide, claws) => {
      const c2 = canvas((len + 3) * ppu, (wide + 5) * ppu), x2 = c2.getContext('2d'); x2.scale(ppu, ppu); x2.translate(1, (wide + 5) / 2);
      const q = new Path2D(); q.moveTo(0, -3.4); q.bezierCurveTo(len * .3, -3.5, len * .45, -2.9, len * .58, -2.9); q.bezierCurveTo(len * .75, -wide * .55, len + .4, -wide * .48, len + .6, 0); q.bezierCurveTo(len + .4, wide * .48, len * .75, wide * .55, len * .58, 2.9); q.bezierCurveTo(len * .45, 2.9, len * .3, 3.5, 0, 3.4); q.closePath();
      skinPaint(x2, T, q, len, [-1.3, 1.3]);
      for (let k = 0; k < claws; k++) { const yy = (k - (claws - 1) / 2) * (wide * .78 / claws); x2.beginPath(); x2.moveTo(len * .9, yy); x2.lineTo(len + 1.3, yy * 1.15); x2.strokeStyle = 'rgba(226,216,180,.8)'; x2.lineWidth = .32; x2.lineCap = 'round'; x2.stroke(); }
      return { canvas: c2, ppu, px: 1 / (len + 3), py: .5 };
    };
    parts.front = leg(11, 8.2, 5); parts.back = leg(9, 8.6, 4);
    c = canvas(9 * ppu, 5 * ppu); ctx = c.getContext('2d'); ctx.scale(ppu, ppu); ctx.translate(.5, 2.5);
    p = new Path2D(); p.moveTo(0, -1.8); p.quadraticCurveTo(5, -1.2, 8, 0); p.quadraticCurveTo(5, 1.2, 0, 1.8); p.closePath();
    skinPaint(ctx, T, p, 8, [0]);
    parts.tail = { canvas: c, ppu, px: .5 / 9, py: .5 };
    return parts;
  }

  // ---------- Butterflies ----------
  // Right wing, body axis on the left edge, head up. Species: cabbage white, sulphur, swallowtail.
  const BUTTERFLIES = [
    { fill: ['#f7f4ea', '#efe9d8'], vein: 'rgba(120,120,105,.35)', dust: 'rgba(90,92,86,.55)' },
    { fill: ['#f6dc6c', '#f1c94c'], vein: 'rgba(150,110,40,.35)', dust: 'rgba(160,120,50,.45)' },
    { fill: ['#26292a', '#1b1d1e'], vein: 'rgba(0,0,0,.4)', dust: 'rgba(10,10,10,.5)', tail: true }
  ];
  function wingPaths(tail) {
    const fore = new Path2D(); fore.moveTo(0, -2.5); fore.bezierCurveTo(8, -12, 22, -23, 33, -22); fore.bezierCurveTo(36, -20, 34, -11, 30, -4); fore.bezierCurveTo(27, 0, 20, 2, 12, 2); fore.bezierCurveTo(6, 2, 2, 1, 0, .5); fore.closePath();
    const hind = new Path2D(); hind.moveTo(0, 0); hind.bezierCurveTo(8, -1, 20, -1, 25, 6);
    if (tail) { hind.bezierCurveTo(26, 12, 22, 18, 19, 21); hind.bezierCurveTo(18.5, 25, 19, 30, 17, 33); hind.bezierCurveTo(15.4, 30, 15.2, 26, 15.4, 23); hind.bezierCurveTo(11, 25, 5, 20, 2, 12); }
    else { hind.bezierCurveTo(29, 13, 23, 23, 15, 25); hind.bezierCurveTo(7, 25, 3, 18, 1.5, 11); }
    hind.closePath();
    return { fore, hind };
  }
  function butterflySprites(species, ppu = 3.2) {
    const B = BUTTERFLIES[species], c = canvas(38 * ppu, 58 * ppu), ctx = c.getContext('2d');
    ctx.scale(ppu, ppu); ctx.translate(.5, 24);
    const { fore, hind } = wingPaths(B.tail);
    const paint = (path, isFore) => {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 34); g.addColorStop(0, B.fill[1]); g.addColorStop(1, B.fill[0]);
      ctx.fillStyle = g; ctx.fill(path);
      ctx.save(); ctx.clip(path);
      if (species === 0 && isFore) { const a = ctx.createRadialGradient(34, -22, 0, 34, -22, 11); a.addColorStop(0, 'rgba(40,40,38,.95)'); a.addColorStop(.7, 'rgba(40,40,38,.85)'); a.addColorStop(1, 'rgba(40,40,38,0)'); ctx.fillStyle = a; ctx.fillRect(18, -30, 22, 22); ctx.beginPath(); ctx.arc(20, -8, 2.4, 0, TAU); ctx.fillStyle = 'rgba(45,45,42,.85)'; ctx.fill(); }
      if (species === 0 && !isFore) { ctx.beginPath(); ctx.arc(18, 1, 1.6, 0, TAU); ctx.fillStyle = 'rgba(60,60,55,.5)'; ctx.fill(); }
      if (species === 1) { ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(92,62,28,.55)'; ctx.stroke(path); if (isFore) { ctx.beginPath(); ctx.arc(17, -9, 1.3, 0, TAU); ctx.fillStyle = 'rgba(80,50,20,.8)'; ctx.fill(); } else { ctx.beginPath(); ctx.arc(13, 9, 1.6, 0, TAU); ctx.fillStyle = 'rgba(232,130,40,.85)'; ctx.fill(); } }
      if (species === 2) {
        ctx.fillStyle = 'rgba(240,234,212,.92)';
        if (isFore) for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.ellipse(27 - k * .6, -17 + k * 3.2, 1.3, .9, .4, 0, TAU); ctx.fill(); }
        else { for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(6 + k * 3.3, 6 + k * .9, 1.9, 3.2, -.5, 0, TAU); ctx.fill(); } ctx.fillStyle = 'rgba(196,72,50,.9)'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(11 + k * 3.6, 18.5 - k * 3, 1.05, 0, TAU); ctx.fill(); } ctx.fillStyle = 'rgba(120,160,190,.55)'; ctx.beginPath(); ctx.arc(20.5, 12, 1.2, 0, TAU); ctx.fill(); }
      }
      // Veins radiate from the wing root.
      ctx.strokeStyle = B.vein; ctx.lineWidth = .32;
      const vs = isFore ? [[-.95, 34], [-.75, 36], [-.55, 34], [-.35, 31], [-.15, 28], [.05, 22]] : [[.05, 26], [.35, 27], [.7, 27], [1.05, 26], [1.35, 22]];
      for (const [a, l] of vs) { ctx.beginPath(); ctx.moveTo(1, isFore ? -.5 : 1); ctx.quadraticCurveTo(Math.cos(a) * l * .5, Math.sin(a) * l * .5 + (isFore ? -1 : 1), Math.cos(a) * l, Math.sin(a) * l); ctx.stroke(); }
      const dust = ctx.createRadialGradient(0, 0, 0, 0, 0, 9); dust.addColorStop(0, B.dust); dust.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dust; ctx.fillRect(-1, -12, 14, 24);
      ctx.restore();
      ctx.strokeStyle = species === 2 ? 'rgba(10,10,10,.6)' : 'rgba(80,72,60,.35)'; ctx.lineWidth = .35; ctx.stroke(path);
    };
    paint(hind, false); paint(fore, true);
    const wing = { canvas: c, ppu, px: .5 / 38, py: 24 / 58 };
    const b = canvas(10 * ppu, 30 * ppu), x = b.getContext('2d'); x.scale(ppu, ppu); x.translate(5, 11);
    x.strokeStyle = species === 2 ? '#2a2a28' : '#4b4a40'; x.lineWidth = .35; x.lineCap = 'round';
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * .4, -4.4); x.quadraticCurveTo(s * 1.6, -8, s * 3.2, -10.2); x.stroke(); x.beginPath(); x.arc(s * 3.3, -10.3, .5, 0, TAU); x.fillStyle = x.strokeStyle; x.fill(); }
    const bodyG = x.createLinearGradient(-1.5, 0, 1.5, 0); bodyG.addColorStop(0, '#2e2c26'); bodyG.addColorStop(.5, species === 1 ? '#8a7a4a' : '#5a574c'); bodyG.addColorStop(1, '#2e2c26');
    x.fillStyle = bodyG;
    x.beginPath(); x.ellipse(0, -3.6, 1.2, 1.1, 0, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(0, .2, 1.55, 3, 0, 0, TAU); x.fill();
    x.beginPath(); x.moveTo(-1.1, 2.4); x.quadraticCurveTo(-1.2, 10, 0, 15.5); x.quadraticCurveTo(1.2, 10, 1.1, 2.4); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(230,220,190,.25)'; x.lineWidth = .2; for (let k = 0; k < 5; k++) { x.beginPath(); x.moveTo(-1, 4 + k * 2.2); x.lineTo(1, 4 + k * 2.2); x.stroke(); }
    return { wing, body: { canvas: b, ppu, px: .5, py: 11 / 30 } };
  }

  // ---------- Dragonflies ----------
  // Body with the head up, pivot at the wing roots; one wing shape reused four times, root on the left.
  const DRAGONFLIES = [
    { thorax: ['#b8412c', '#8e2c1e'], abdomen: ['#d24b2f', '#9b2f1c'], eye: '#7a2418', vein: 'rgba(110,60,35,.55)', tint: 'rgba(222,150,80,.5)' },
    { thorax: ['#5c8a3a', '#34552a'], abdomen: ['#3f8fb0', '#23566e'], eye: '#2f6f5a', vein: 'rgba(40,60,70,.55)', tint: 'rgba(170,200,180,.4)' }
  ];
  function dragonflySprites(species, ppu = 4) {
    const D = DRAGONFLIES[species], b = canvas(10 * ppu, 40 * ppu), x = b.getContext('2d');
    x.scale(ppu, ppu); x.translate(5, 9);
    const grad = (c, x0, x1) => { const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, c[1]); g.addColorStop(.5, c[0]); g.addColorStop(1, c[1]); return g; };
    x.fillStyle = grad(D.abdomen, -1.1, 1.1);
    x.beginPath(); x.moveTo(-1, 2); x.bezierCurveTo(-1.1, 12, -.8, 22, -.45, 29); x.lineTo(.45, 29); x.bezierCurveTo(.8, 22, 1.1, 12, 1, 2); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(30,15,10,.45)'; x.lineWidth = .22; for (let k = 0; k < 9; k++) { const yy = 4 + k * 2.8, hw = 1 - k * .06; x.beginPath(); x.moveTo(-hw, yy); x.lineTo(hw, yy); x.stroke(); }
    x.fillStyle = grad(D.thorax, -2, 2); x.beginPath(); x.ellipse(0, 0, 2, 3.2, 0, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(255,240,200,.25)'; x.lineWidth = .3; x.beginPath(); x.moveTo(-.9, -2.2); x.lineTo(-.6, 2.2); x.moveTo(.9, -2.2); x.lineTo(.6, 2.2); x.stroke();
    for (const s of [-1, 1]) { const e = x.createRadialGradient(s * 1.3, -4.3, .2, s * 1.2, -4.2, 2); e.addColorStop(0, '#fff'); e.addColorStop(.2, D.eye); e.addColorStop(1, 'rgba(20,20,20,.9)'); x.fillStyle = e; x.beginPath(); x.ellipse(s * 1.2, -4.2, 1.6, 1.7, 0, 0, TAU); x.fill(); }
    const w = canvas(18 * ppu, 5 * ppu), y = w.getContext('2d'); y.scale(ppu, ppu); y.translate(.5, 2.5);
    const p = new Path2D(); p.moveTo(0, -.5); p.bezierCurveTo(4, -2, 13, -2.1, 16.6, -.9); p.quadraticCurveTo(17.4, 0, 16.4, .8); p.bezierCurveTo(12, 1.9, 4, 1.6, 0, .6); p.closePath();
    const g = y.createLinearGradient(0, 0, 17, 0); g.addColorStop(0, D.tint); g.addColorStop(.35, 'rgba(236,242,246,.42)'); g.addColorStop(1, 'rgba(236,242,246,.34)');
    y.fillStyle = g; y.fill(p); y.save(); y.clip(p); y.strokeStyle = D.vein; y.lineWidth = .12;
    for (let k = -2; k <= 2; k++) { y.beginPath(); y.moveTo(0, k * .15); y.quadraticCurveTo(8, k * .55, 17, k * .35); y.stroke(); }
    for (let k = 1; k < 34; k++) { y.beginPath(); y.moveTo(k * .5, -2); y.lineTo(k * .5 + .2, 2); y.stroke(); }
    y.fillStyle = 'rgba(40,30,25,.8)'; y.fillRect(14.4, -1.05, 1.3, .6); y.restore();
    y.strokeStyle = 'rgba(70,70,70,.55)'; y.lineWidth = .18; y.stroke(p);
    y.beginPath(); y.moveTo(.5, -.6); y.bezierCurveTo(4, -1.8, 12, -1.9, 16.3, -.8); y.strokeStyle = 'rgba(255,255,255,.55)'; y.lineWidth = .25; y.stroke();
    return { body: { canvas: b, ppu, px: .5, py: 9 / 40 }, wing: { canvas: w, ppu, px: .5 / 18, py: .5 } };
  }

  // ---------- Props ----------
  // ---------- Crabs ----------
  // Small freshwater crabs seen from above, in parts so legs and claws can move: a stream crab (溪蟹) in red-brown
  // and an olive marsh crab. Units: the carapace is 12 wide (across) × 9.5 long; front (eyes, claws) points to +x.
  const CRABS = [
    { shell: '#7a3620', light: '#b4643c', groove: '#4a1c10', claw: '#b3502c', tip: '#ecd2a8', leg: '#8c4428', eye: '#1b1310' },
    { shell: '#57542f', light: '#8a8350', groove: '#2e2c16', claw: '#9b5a34', tip: '#e2cfa0', leg: '#5f5a33', eye: '#15140d' }
  ];
  function crabSprites(v, ppu = 6) {
    const C = CRABS[v], out = {};
    // Carapace: a broad rounded trapezoid, wider at the front, with the H-shaped groove, granules and stalked eyes.
    { const c = canvas(12 * ppu, 14 * ppu), x = c.getContext('2d'); x.scale(ppu, ppu); x.translate(6, 7);
      const p = new Path2D(); p.moveTo(4.9, -5.6); p.bezierCurveTo(5.6, -3, 5.4, 3, 4.9, 5.6); p.bezierCurveTo(2.4, 6.4, -2.6, 5.6, -4.4, 3.4); p.bezierCurveTo(-5.4, 1.4, -5.4, -1.4, -4.4, -3.4); p.bezierCurveTo(-2.6, -5.6, 2.4, -6.4, 4.9, -5.6); p.closePath();
      const g = x.createRadialGradient(1, -1, .5, 0, 0, 6.6); g.addColorStop(0, C.light); g.addColorStop(.55, C.shell); g.addColorStop(1, C.groove);
      x.fillStyle = g; x.fill(p);
      x.save(); x.clip(p);
      const n = valueNoise(v * 31 + 5);
      for (let i = 0; i < 60; i++) { const a = n(i * .7, 1.3) * TAU, r = Math.sqrt(n(3.1, i * .9)) * 5.2; x.beginPath(); x.arc(Math.cos(a) * r * .9, Math.sin(a) * r, .22 + n(i, 7) * .2, 0, TAU); x.fillStyle = n(i, 2) > .5 ? 'rgba(255,230,190,.16)' : 'rgba(30,10,4,.18)'; x.fill(); }
      x.strokeStyle = C.groove; x.globalAlpha = .55; x.lineWidth = .32;
      x.beginPath(); x.moveTo(-.4, -2.6); x.quadraticCurveTo(.4, 0, -.4, 2.6); x.moveTo(1.8, -2.2); x.quadraticCurveTo(.2, -1.4, -1.8, -2.2); x.moveTo(1.8, 2.2); x.quadraticCurveTo(.2, 1.4, -1.8, 2.2); x.stroke();
      x.globalAlpha = 1; x.restore();
      x.strokeStyle = 'rgba(20,8,4,.5)'; x.lineWidth = .28; x.stroke(p);
      for (const s of [-1, 1]) { x.beginPath(); x.ellipse(5.4, s * 2.2, .8, .6, 0, 0, TAU); x.fillStyle = C.eye; x.fill(); x.beginPath(); x.arc(5.6, s * 2.2 - .2, .2, 0, TAU); x.fillStyle = 'rgba(255,255,255,.7)'; x.fill(); }
      out.body = { canvas: c, ppu, px: .5, py: .5 }; }
    // Walking leg: a stout upper segment out from the body, then a knee bending back toward the tail
    // and a dark pointed tip; the pivot is the root. In sprite space +y is toward the crab's rear on either side.
    { const c = canvas(9 * ppu, 5 * ppu), x = c.getContext('2d'); x.scale(ppu, ppu); x.translate(0, 1.4); x.lineCap = 'round'; x.lineJoin = 'round';
      x.strokeStyle = C.leg; x.lineWidth = 1.25; x.beginPath(); x.moveTo(.3, 0); x.lineTo(4.4, -.25); x.stroke();
      x.lineWidth = .9; x.beginPath(); x.moveTo(4.4, -.25); x.lineTo(7, 1.7); x.stroke();
      x.strokeStyle = C.groove; x.lineWidth = .55; x.beginPath(); x.moveTo(6.6, 1.4); x.lineTo(8.1, 3); x.stroke();
      x.fillStyle = C.light; x.beginPath(); x.arc(4.4, -.25, .5, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(255,230,190,.25)'; x.lineWidth = .3; x.beginPath(); x.moveTo(.6, -.4); x.lineTo(4, -.6); x.stroke();
      out.leg = { canvas: c, ppu, px: 0, py: 1.4 / 5 }; }
    // Claw: a short arm and a heavy pincer, pale at the finger tips; drawn for the right side, mirrored for the left.
    { const c = canvas(9 * ppu, 6 * ppu), x = c.getContext('2d'); x.scale(ppu, ppu); x.translate(.2, 3);
      x.strokeStyle = C.claw; x.lineCap = 'round'; x.lineWidth = 1.1; x.beginPath(); x.moveTo(0, 0); x.lineTo(3, .4); x.stroke();
      const palm = x.createLinearGradient(3, -1.6, 3, 2.4); palm.addColorStop(0, C.light); palm.addColorStop(1, C.claw);
      x.fillStyle = palm; x.beginPath(); x.ellipse(4.6, .5, 2, 1.55, -.15, 0, TAU); x.fill();
      x.fillStyle = C.tip;
      x.beginPath(); x.moveTo(6, -.5); x.quadraticCurveTo(8.4, -1.2, 8.6, .2); x.quadraticCurveTo(7.6, -.1, 6.2, .3); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(6, 1.2); x.quadraticCurveTo(8, 2.1, 8.3, .9); x.quadraticCurveTo(7.3, 1, 6.1, .6); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(30,10,4,.35)'; x.lineWidth = .22; x.beginPath(); x.ellipse(4.6, .5, 2, 1.55, -.15, 0, TAU); x.stroke();
      out.claw = { canvas: c, ppu, px: .02, py: .5 }; }
    return out;
  }

  function pelletSprite() {
    const c = canvas(28, 28), ctx = c.getContext('2d'), g = ctx.createRadialGradient(11, 10, 1, 14, 14, 11);
    g.addColorStop(0, '#e2c27c'); g.addColorStop(.35, '#b88645'); g.addColorStop(.85, '#7c5226'); g.addColorStop(1, 'rgba(90,60,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(14, 14, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,248,220,.75)'; ctx.beginPath(); ctx.ellipse(10.5, 9.5, 2.6, 1.8, -.6, 0, TAU); ctx.fill();
    return { canvas: c, ppu: 4, px: .5, py: .5 };
  }
  function dotSprite() {
    const c = canvas(48, 48), ctx = c.getContext('2d'), g = ctx.createRadialGradient(24, 24, 0, 24, 24, 23);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.75)'); g.addColorStop(.6, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 48, 48);
    return { canvas: c, ppu: 4, px: .5, py: .5 };
  }
  function flakeSprite() {
    const c = canvas(32, 32), ctx = c.getContext('2d'), g = ctx.createRadialGradient(15, 15, 0, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.45, 'rgba(250,252,255,.92)'); g.addColorStop(.8, 'rgba(240,246,255,.35)'); g.addColorStop(1, 'rgba(240,246,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    return { canvas: c, ppu: 4, px: .5, py: .5 };
  }
  // A splash ring: a bright rim with a soft halo, for raindrops landing on leaves and water.
  function ringSprite() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(32, 32, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(32, 32, 24, 0, Math.PI * 2); ctx.stroke();
    return { canvas: c, ppu: 4, px: .5, py: .5 };
  }
  function streakSprite() {
    const c = canvas(10, 90), ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 90);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.75, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(4.4, 0); ctx.lineTo(5.6, 0); ctx.lineTo(6.4, 89); ctx.lineTo(3.6, 89); ctx.closePath(); ctx.fill();
    return { canvas: c, ppu: 1, px: .5, py: 1 };
  }
  function petalSprite(ppu = 4) {
    const c = canvas(20 * ppu, 10 * ppu), ctx = c.getContext('2d'); ctx.scale(ppu, ppu); ctx.translate(1, 5);
    const p = new Path2D(); p.moveTo(0, 0); p.bezierCurveTo(3, -4.2, 12, -4.6, 18, 0); p.bezierCurveTo(12, 4.6, 3, 4.2, 0, 0); p.closePath();
    const g = ctx.createLinearGradient(0, 0, 18, 0); g.addColorStop(0, '#f6efe8'); g.addColorStop(.55, '#f1cfd6'); g.addColorStop(1, '#e493a8');
    ctx.fillStyle = g; ctx.fill(p);
    ctx.save(); ctx.clip(p); ctx.strokeStyle = 'rgba(205,120,145,.35)'; ctx.lineWidth = .2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(.5, 0); ctx.quadraticCurveTo(9, k * 1.1, 18, k * .3); ctx.stroke(); }
    const s = ctx.createLinearGradient(0, -4, 0, 4); s.addColorStop(0, 'rgba(255,255,255,.35)'); s.addColorStop(.5, 'rgba(255,255,255,0)'); s.addColorStop(1, 'rgba(120,60,80,.15)');
    ctx.fillStyle = s; ctx.fillRect(0, -5, 19, 10); ctx.restore();
    return { canvas: c, ppu, px: .5, py: .5 };
  }
  function miscSprites() {
    const s = { fin: finSprite(4, false), finMoto: finSprite(4, true), pellet: pelletSprite(), dot: dotSprite(), flake: flakeSprite(), streak: streakSprite(), ring: ringSprite(), petal: petalSprite() };
    for (let v = 0; v < TURTLES.length; v++) { const t = turtleSprites(v); for (const k in t) s[`turtle${v}_${k}`] = t[k]; }
    for (let b = 0; b < BUTTERFLIES.length; b++) { const t = butterflySprites(b); s[`bf${b}_wing`] = t.wing; s[`bf${b}_body`] = t.body; }
    for (let d = 0; d < DRAGONFLIES.length; d++) { const t = dragonflySprites(d); s[`df${d}_wing`] = t.wing; s[`df${d}_body`] = t.body; }
    for (let v = 0; v < CRABS.length; v++) { const t = crabSprites(v); for (const k in t) s[`crab${v}_${k}`] = t[k]; }
    return s;
  }
  root.PondArt = { fishSprite, fishLayers, halfWidth, girthOf, miscSprites, valueNoise, TURTLE_COUNT: TURTLES.length, BUTTERFLY_COUNT: BUTTERFLIES.length, DRAGONFLY_COUNT: DRAGONFLIES.length, CRAB_COUNT: CRABS.length };
})(window);
