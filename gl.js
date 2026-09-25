// Pond renderer. WebGL2 path: GPU ripple simulation, caustics, refraction and glints over a sprite scene.
// Canvas 2D fallback keeps the pond usable (no water shading) where WebGL2 is missing.
(function (root) {
  'use strict';
  const { BODY } = root.PondCore;
  const ATLAS = 2048, FISH_PPU = 3.5, CELL_W = Math.round(BODY.width * FISH_PPU), CELL_H = Math.round(BODY.half * 2 * FISH_PPU);
  const CELL_COLS = 6, CELL_PITCH_X = 340, CELL_PITCH_Y = CELL_H + 4, MISC_Y = CELL_PITCH_Y * 11 + 8, MAX_FISH = 66, SEG_UNITS = BODY.length / BODY.segments;
  const cellOrigin = i => [(i % CELL_COLS) * CELL_PITCH_X + 2, Math.floor(i / CELL_COLS) * CELL_PITCH_Y + 2];

  // Screen uv (y up) → uv in the painted pond. The painting is fitted to the screen and, on a portrait screen,
  // turned a quarter so the whole pond fills it; uBedU/uBedV are the rows of that affine map.
  const BED = `vec2 bedUv(vec2 uv){ vec3 s = vec3(uv.x, 1. - uv.y, 1.); return vec2(dot(uBedU, s), dot(uBedV, s)); }`;

  const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

  const FS_DROP = `#version 300 es
precision highp float;
uniform sampler2D uState; uniform vec4 uDrops[24]; uniform int uCount; uniform float uAspect;
in vec2 vUv; out vec4 o;
void main(){
  vec4 s = texture(uState, vUv);
  for (int i = 0; i < 24; i++) {
    if (i >= uCount) break;
    vec4 d = uDrops[i]; float r = length((vUv - d.xy) * vec2(uAspect, 1.)) / d.z;
    if (r < 1.) s.r += (.5 + .5 * cos(r * 3.14159265)) * d.w;
  }
  o = s;
}`;

  const FS_SIM = `#version 300 es
precision highp float;
uniform sampler2D uState, uFloat; uniform vec2 uTexel; uniform vec3 uBedU, uBedV; uniform float uDamp, uAspect;
in vec2 vUv; out vec4 o;
${BED}
void main(){
  vec4 s = texture(uState, vUv);
  float avg = .25 * (texture(uState, vUv + vec2(uTexel.x, 0.)).r + texture(uState, vUv - vec2(uTexel.x, 0.)).r
                   + texture(uState, vUv + vec2(0., uTexel.y)).r + texture(uState, vUv - vec2(0., uTexel.y)).r);
  s.g += (avg - s.r) * 1.9;
  vec2 e = min(vUv, 1. - vUv);
  float edge = smoothstep(0., .04, min(e.x * uAspect, e.y));
  s.g *= mix(.9, uDamp, edge);
  s.r += s.g;
  // A touch of viscosity so grid-scale noise dies out before it can jag the refraction.
  s.r = mix(s.r, avg, .012) * mix(.95, .9993, edge);
  // Leaves and rocks hold the water still, so ripples break and reflect around them.
  o = s * (1. - texture(uFloat, bedUv(vUv)).r);
}`;

  const FS_CAUSTIC = `#version 300 es
precision highp float;
uniform float uTime, uCell; uniform vec2 uView; uniform sampler2D uNoise;
in vec2 vUv; out vec4 o;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float edges(vec2 p, float t){
  vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), h = hash2(i + g);
    vec2 c = g + .5 + .38 * sin(t * (.55 + .45 * h.yx) + 6.2831 * h) - f;
    float d = dot(c, c);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
void main(){
  vec2 px = vUv * uView;
  vec2 w = texture(uNoise, px / 640. + vec2(uTime * .007, -uTime * .005)).rg - .5;
  vec2 w2 = texture(uNoise, px / 300. + vec2(-uTime * .011, uTime * .008)).ba - .5;
  vec2 p = px / uCell + w * 1.3 + w2 * .5;
  float e1 = edges(p, uTime * .8), e2 = edges(p * 1.55 + 7.3, uTime * 1.1 + 3.);
  float c = pow(1. - smoothstep(0., .2, e1), 3.) + .5 * pow(1. - smoothstep(0., .16, e2), 3.);
  c *= .45 + .9 * texture(uNoise, px / 1200. + uTime * .004).g;
  o = vec4(c, c, c, 1.);
}`;

  // Cloud shadows: great soft-edged masses that drift across the pond with the wind and slowly change shape.
  // r = how deeply this spot is shaded (0 in full sun). Rendered small; everything sun-lit reads it.
  const FS_CLOUD = `#version 300 es
precision highp float;
uniform sampler2D uNoise; uniform vec2 uView, uWind; uniform float uTime, uCover, uUnit;
in vec2 vUv; out vec4 o;
void main(){
  vec2 p = vUv * uView / uUnit - uWind * uTime;
  vec2 warp = vec2(texture(uNoise, p * .7 + vec2(.13, uTime * .0011)).a, texture(uNoise, p * .7 + vec2(.61, -uTime * .0009)).g) - .5;
  p += warp * .08;
  float n = texture(uNoise, p).r * .62 + texture(uNoise, p * 2.1 + .31).b * .26 + texture(uNoise, p * 4.3 + .77).g * .12;
  float thr = mix(.63, .37, uCover);
  // A thin bright fringe, then the shadow deepens toward the thick heart of the cloud.
  float shade = smoothstep(thr - .03, thr + .045, n) * (.7 + .3 * smoothstep(thr, thr + .1, n));
  o = vec4(mix(shade, 1., smoothstep(.85, 1., uCover)), 0., 0., 1.);
}`;

  const FS_BED = `#version 300 es
precision highp float;
uniform sampler2D uBed, uShadow, uCaustic, uFloat, uCloud;
uniform vec3 uBedU, uBedV; uniform vec2 uFloatShift, uShadowTexel; uniform float uCausticK, uShadowK; uniform vec3 uCausticTint;
in vec2 vUv; out vec4 o;
${BED}
float shadowAt(vec2 uv, float lod){
  vec2 t = uShadowTexel * exp2(lod) * .7;
  return .25 * (textureLod(uShadow, uv + t, lod).a + textureLod(uShadow, uv - t, lod).a + textureLod(uShadow, uv + vec2(t.x, -t.y), lod).a + textureLod(uShadow, uv + vec2(-t.x, t.y), lod).a);
}
void main(){
  vec2 b = bedUv(vUv);
  // Under a leaf there is only shaded water; painting it plainly keeps refraction from dragging copies of the leaf out.
  vec3 c = mix(texture(uBed, b).rgb, textureLod(uBed, b, 5.).rgb * .82, texture(uFloat, b).r);
  // In sunshine shadows are crisp and dark; under a cloud only a soft, pale patch stays beneath each fish.
  float sun = 1. - texture(uCloud, vUv).r;
  float sh = max(shadowAt(vUv, .3 + (1. - sun) * 1.7), textureLod(uFloat, b - uFloatShift, 2. + (1. - sun)).g * .6) * mix(.42, 1., sun);
  // Water swallows red light first, so shade on the bed is a cool blue-green rather than grey.
  c *= 1. - sh * uShadowK * vec3(1., .86, .72);
  c += texture(uCaustic, vUv).r * uCausticK * uCausticTint * (1. - sh) * mix(.06, 1., sun * sun);
  o = vec4(c, 1.);
}`;

  const VS_SPRITE = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec4 aColor; in vec4 aFog; in vec4 aLight;
uniform vec2 uView;
out vec2 vUv; out vec4 vColor; out vec4 vFog; out vec4 vLight; out vec2 vScreen;
void main(){
  vec2 c = aPos / uView * 2. - 1.; c.y = -c.y;
  gl_Position = vec4(c, 0., 1.);
  vScreen = c * .5 + .5; vUv = aUv; vColor = aColor; vFog = aFog; vLight = aLight;
}`;

  const FS_SPRITE = `#version 300 es
precision highp float;
uniform sampler2D uTex, uCaustic, uCloud; uniform int uMode; uniform float uBias, uCausticK, uLightK, uShadowCloud; uniform vec3 uLight;
in vec2 vUv; in vec4 vColor; in vec4 vFog; in vec4 vLight; in vec2 vScreen; out vec4 o;
void main(){
  // Shadows carry their own blur in vFog.x: fish near the surface cast softer shadows than those near the bed.
  vec4 t = texture(uTex, vUv, uBias + (uMode == 1 ? vFog.x : 0.));
  // Koi bodies: vLight = (side across the strip, body half-width / strip half-height, metal, gloss).
  // The body is lit as a cylinder, so the flank facing the sun brightens and the sheen slides round as the fish turns.
  vec2 across = vec2(dFdx(vLight.x), dFdy(vLight.x));
  float a = t.a * vColor.a, sun = 1. - texture(uCloud, vScreen).r;
  if (uMode == 1) { o = vec4(0., 0., 0., a * mix(1., .35 + .65 * sun, uShadowCloud)); return; }
  vec3 rgb = t.rgb * vColor.rgb * vColor.a;
  if (vLight.y > .02) {
    float q = vLight.x / vLight.y, lat = clamp(q, -.999, .999), body = 1. - smoothstep(.96, 1.02, abs(q)), lk = uLightK * mix(.3, 1., sun);
    vec3 n = vec3(normalize(across + 1e-7) * lat, sqrt(1. - lat * lat)), L = normalize(uLight);
    float sp = pow(max(dot(n, normalize(L + vec3(0., 0., 1.))), 0.), mix(20., 46., vLight.z)) * vLight.w * uLightK * mix(.12, 1., sun);
    vec3 tint = mix(vec3(1., .97, .9), clamp(t.rgb / max(t.a, .01) * 1.3, 0., 1.4), vLight.z * .7);
    rgb = mix(rgb, rgb * (1. + dot(n.xy, normalize(L.xy)) * .22 * lk) + tint * sp * a, body);
  }
  if (uCausticK > 0.) rgb += texture(uCaustic, vScreen).r * uCausticK * a;
  rgb = mix(rgb, vFog.rgb * a, vFog.a);
  o = uMode == 2 ? vec4(rgb, 0.) : vec4(rgb, a);
}`;

  // Water surface at reduced resolution: slope (ripples + breeze waves), sun glitter and cloud shadow.
  const FS_SURFACE = `#version 300 es
precision highp float;
uniform sampler2D uHeight, uWaves, uNoise;
uniform vec2 uView, uSimTexel; uniform float uTime, uRipple, uWaveAmp; uniform vec3 uSun;
in vec2 vUv; out vec4 o;
void main(){
  vec2 px = vUv * uView, st = uSimTexel * 1.5;
  float hL = texture(uHeight, vUv - vec2(st.x, 0.)).r, hR = texture(uHeight, vUv + vec2(st.x, 0.)).r;
  float hD = texture(uHeight, vUv - vec2(0., st.y)).r, hU = texture(uHeight, vUv + vec2(0., st.y)).r;
  vec2 g = vec2(hR - hL, hU - hD) * uRipple;
  mat2 r1 = mat2(.8, .6, -.6, .8), r2 = mat2(.28, -.96, .96, .28);
  vec2 w1 = texture(uWaves, r1 * px / 560. + vec2(uTime * .010, uTime * .006)).rg * 2. - 1.;
  vec2 w2 = texture(uWaves, r2 * px / 330. + vec2(-uTime * .008, uTime * .011)).rg * 2. - 1.;
  vec2 w3 = texture(uWaves, px / 170. + vec2(uTime * .017, -uTime * .013)).rg * 2. - 1.;
  g += (transpose(r1) * w1 * .55 + transpose(r2) * w2 * .4 + w3 * .22) * uWaveAmp;
  g /= 1. + length(g) * .8;
  // Sun glitter: tiny facets from fast capillary ripples, gathered in drifting patches.
  vec2 hf = texture(uWaves, px / 44. + vec2(uTime * .09, -uTime * .07)).rg * 2. - 1.;
  vec2 hf2 = texture(uWaves, r2 * px / 27. + vec2(-uTime * .12, uTime * .05)).rg * 2. - 1.;
  vec3 Ng = normalize(vec3(-(g * .6 + (hf + transpose(r2) * hf2) * .2 * (.4 + uWaveAmp)), 1.));
  float patchy = smoothstep(.3, .75, texture(uNoise, px / 480. + vec2(uTime * .012, uTime * .007)).b);
  float glint = pow(max(dot(Ng, normalize(uSun + vec3(0., 0., 1.))), 0.), 1100.) * patchy;
  o = vec4(g * .25 + .5, min(1., glint), 1.);
}`;

  // Low banks of mist in screen px, shared by the water and the leaves so they sit in the same air.
  const MIST = `float mistAt(vec2 px, float t){
  float m = texture(uNoise, px / 1100. + vec2(t * .011, t * .004)).r * .6 + texture(uNoise, px / 480. + vec2(-t * .017, t * .009)).a * .4;
  return smoothstep(.36, .72, m);
}`;

  const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uScene, uSurface, uFloat, uNoise, uCloud;
uniform vec4 uMoonDisc; uniform vec3 uBedU, uBedV; uniform vec2 uView;
uniform float uRefract, uGlint, uSkyK, uVignette, uMoon, uBright, uSat, uShade, uTime, uCloudShade, uMist, uFlash;
uniform vec3 uGlintColor, uSky, uTint, uSun;
in vec2 vUv; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
${MIST}
${BED}
void main(){
  vec4 sf = texture(uSurface, vUv);
  vec2 g = (sf.rg - .5) * 4.;
  vec3 N = normalize(vec3(-g, 1.));
  vec3 col = texture(uScene, clamp(vUv + N.xy * uRefract / uView, .001, .999)).rgb;
  float cloud = texture(uCloud, vUv).r, dim = cloud * uCloudShade;
  // Facets tilted toward the sun read lighter, the far side of each ripple darker; the sun side only counts in sunshine.
  col *= (1. - dim) * (1. + dot(-g, normalize(uSun.xy)) * uShade * (1. - cloud * .6));
  // In a cloud's shadow the pond turns cool, grey and flat; where the sun comes back it is warm and clear again.
  col = mix(col * vec3(1.025, 1.01, .98), vec3(dot(col, vec3(.299, .587, .114))) * vec3(.93, .99, 1.07), min(1., dim * 1.1));
  col = mix(col, uSky, clamp(uSkyK * (1. + length(g) * 5.) + dim * .06, 0., .6));
  vec3 glint = uGlintColor * sf.b * 2.4 * uGlint * (1. - cloud * .92), night = vec3(0.);
  if (uMoon > 0.) {
    // The moon mirrored in the pond: looked up where the tilted surface points, so waves break it apart.
    vec2 px = vUv * uView, rp = px + g * 22., d = (rp - uMoonDisc.xy) / uMoonDisc.z;
    float r = length(d), s = sqrt(max(0., 1. - d.y * d.y)), k = cos(uMoonDisc.w), illum = .5 - .5 * k;
    // Phase: the terminator is a half-ellipse; uMoonDisc.w runs 0 (new) → pi (full) → 2pi.
    float lit = uMoonDisc.w < 3.14159 ? smoothstep(k * s - .07, k * s + .07, d.x) : smoothstep(-k * s + .07, -k * s - .07, d.x);
    // The familiar face: dark maria placed roughly where they sit on the real moon, plus fine mottling.
    float maria = 0.;
    maria += 1. - smoothstep(.16, .3, length(d - vec2(-.32, .3)));
    maria += 1. - smoothstep(.12, .24, length(d - vec2(.18, .36)));
    maria += 1. - smoothstep(.12, .26, length(d - vec2(.36, .06)));
    maria += 1. - smoothstep(.18, .34, length(d - vec2(-.52, -.06)));
    maria += 1. - smoothstep(.08, .2, length(d - vec2(-.08, -.4)));
    float face = (1. - .24 * min(maria, 1.)) * (.9 + .16 * texture(uNoise, d * .5 + .37).r);
    // Ripples crossing the reflection light one side of each wave and shade the other.
    float disc = (1. - smoothstep(.93, 1.03, r)) * mix(.05, 1., lit) * face * (1. - .18 * r * r) * clamp(1. + dot(-g, vec2(-.6, .6)) * 1.4, .35, 1.6);
    night += vec3(.93, .92, .86) * disc * .78 + vec3(.6, .72, 1.) * (exp(-r * r / 6.) * .2 + exp(-r / 3.5) * .08) * (.3 + .7 * illum);
    // Moonlight glitter gathers round the reflection; a few faint stars twinkle between the waves.
    glint *= (.3 + exp(-length((px - uMoonDisc.xy) / uMoonDisc.z) / 5.) * 1.3) * (.3 + .7 * illum);
    vec2 cell = floor(rp / 38.), f = fract(rp / 38.) - .5, sp = vec2(hash(cell + 3.1), hash(cell + 7.7)) - .5;
    float h = hash(cell), q = dot(f - sp * .7, f - sp * .7);
    if (h > .965) night += vec3(.8, .86, 1.) * exp(-q * 420.) * (.55 + .45 * sin(uTime * (1. + h * 3.) + h * 40.)) * (.6 + 3. * (h - .965));
    // Moonlight on the moving water: every wave facet turned toward the moon's reflection catches its light.
    vec2 toMoon = normalize(uMoonDisc.xy - px + 1e-4);
    float reach = exp(-length(px - uMoonDisc.xy) / (uMoonDisc.z * 16.));
    night += vec3(.55, .66, .9) * (max(0., dot(-g, toMoon)) * .6 + length(g) * .14) * (.35 + .65 * reach) * (.4 + .6 * illum);
    night = (night + glint) * uMoon * (1. - cloud * .9);
    glint = vec3(0.);
  }
  col += glint;
  // A darker wet line where leaves meet the water; the leaves themselves are drawn on top afterwards.
  vec3 fm = texture(uFloat, bedUv(vUv)).rgb;
  col *= 1. - fm.b * (1. - fm.r) * .22;
  float l = dot(col, vec3(.299, .587, .114));
  col = mix(vec3(l), col, uSat) * uBright * uTint + night;
  // Rain mist drifting low over the water in slow banks.
  if (uMist > 0.) col = mix(col, uSky * uBright * 1.08, mistAt(vUv * uView, uTime) * uMist);
  col += uFlash * (col * 1.3 + vec3(.1, .12, .16));
  vec2 v = vUv - .5;
  col *= 1. - dot(v, v) * uVignette;
  o = vec4(col, 1.);
}`;

  // Leaves, flowers and rocks cut from the painting and drawn above the water, so they can bob and sway.
  // aColor = (ellipse-local x, y, ripple push in px, how readily snow settles); aFog = (centre uv, rim offset uv) for the slopes;
  // aLight = (how rain wets it: 1 beads of water on leaves, lower for petals, 0 running streaks on rocks; size of the rain pool
  // that gathers in a big lotus leaf, 0 for none; a per-item seed).
  const VS_FLOAT = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec4 aColor; in vec4 aFog; in vec4 aLight;
uniform vec2 uView; uniform sampler2D uSurface;
out vec2 vUv; out vec2 vLocal; out vec2 vScreen; out vec2 vTilt; out float vSnowK; out float vWet; out float vPool; out float vSeed;
void main(){
  vec2 c = aFog.xy, r = aFog.zw; vSnowK = aColor.w; vWet = aLight.x; vPool = aLight.y; vSeed = aLight.z;
  vec2 g = texture(uSurface, c + vec2(r.x, 0.)).rg + texture(uSurface, c - vec2(r.x, 0.)).rg + texture(uSurface, c + vec2(0., r.y)).rg + texture(uSurface, c - vec2(0., r.y)).rg;
  g = (g * .25 - .5) * 4.; vTilt = vec2(-g.x, g.y);
  vec2 q = (aPos + vec2(-g.x, g.y) * aColor.z) / uView * 2. - 1.; q.y = -q.y;
  gl_Position = vec4(q, 0., 1.); vUv = aUv; vLocal = aColor.xy; vScreen = q * .5 + .5;
}`;

  const FS_FLOAT = `#version 300 es
precision highp float;
uniform sampler2D uBed, uSurface, uNoise, uCloud; uniform vec2 uView;
uniform float uBright, uSat, uVignette, uShade, uSnow, uSkyK, uWet, uRain, uTime, uCloudShade, uMist, uFlash; uniform vec3 uTint, uSky;
in vec2 vUv; in vec2 vLocal; in vec2 vScreen; in vec2 vTilt; in float vSnowK; in float vWet; in float vPool; in float vSeed; out vec4 o;
${MIST}
void main(){
  float e = length(vLocal), a = 1. - smoothstep(1. - fwidth(e) * 1.6, 1., e), snow = uSnow * vSnowK;
  vec3 c = texture(uBed, vUv).rgb * (1. + uShade * .15);
  // Rain wets whatever it falls on (uWet soaks in fast, dries slowly).
  if (uWet > 0.) {
    float lum = dot(c, vec3(.299, .587, .114));
    if (vWet > .05) {
      // Soaked leaves and petals turn a deeper, richer colour.
      c = mix(vec3(lum), c, 1. + .45 * uWet * vWet) * (1. - .1 * uWet * vWet);
      // Beads pool in patches where the leaf dips, denser toward its centre; petals (low vWet) catch far fewer drops.
      vec2 bq = mat2(.8, -.6, .6, .8) * vUv * 62. + .37;   // turned so the beads don't line up with the noise lattice
      float wetPatch = smoothstep(.3, .62, texture(uNoise, vUv * 9. + .63).b + (.55 - e) * .45);
      float n1 = texture(uNoise, bq).r, n2 = texture(uNoise, mat2(.6, .8, -.8, .6) * vUv * 118. + .71).g;
      float bead = smoothstep(.6, .74, n1) * (.6 + .4 * smoothstep(.42, .68, n2)) * uWet * wetPatch * vWet * clamp(mix(1.4, .3, e), 0., 1.);
      // Each bead is a small lens: a dark rim, a sharp glint on the side facing the light (upper left),
      // and light focused into a soft glow on the far side.
      float toLight = n1 - texture(uNoise, bq - .006).r, core = smoothstep(.7, .84, n1);
      float glint = smoothstep(.012, .045, toLight), focus = smoothstep(.012, .05, -toLight) * core;
      c *= 1. - bead * (.42 - core * .18);
      c += vec3(1., 1., .97) * bead * (glint * .9 + focus * .3) * (.85 + .15 * sin(uTime * .6 + n1 * 40. + n2 * 25.));
      // Water gathers in the dip at the heart of a big lotus leaf and rolls about as the leaf tilts on the waves.
      if (vPool > 0.) {
        vec2 pc = vLocal - vec2(.04, .06) - vTilt * .12;
        float pr = (.1 + .17 * smoothstep(.1, 1., uWet)) * vPool;
        // A lobed, uneven edge, the way water spreads over the leaf's veins.
        float ang = atan(pc.y, pc.x);
        float pe = length(pc) / (1. + .16 * sin(ang * 3. + vSeed * 20.) + .08 * sin(ang * 5. - vSeed * 11.)) + (texture(uNoise, vUv * 13. + vSeed).r - .5) * .05;
        float pool = (1. - smoothstep(pr - .025, pr + .003, pe)) * smoothstep(.05, .35, uWet);
        // Now and then a drop lands in the pool and sends a ring out to its rim.
        float beat = uTime * (.45 + .9 * uRain) + vSeed * 7., age = fract(beat);
        float fired = step(.35, fract(sin(floor(beat) * 12.9898 + vSeed * 78.2) * 43758.5));
        float ring = exp(-pow((pe - age * pr * 1.05) / (pr * .07 + .004), 2.)) * (1. - age) * fired;
        // The pool is one broad flat drop: the leaf shows through its middle, its sloping edge bends the light into a dark band,
        // it glints along the side toward the light (upper left) and focuses a bright crescent on the far side.
        float q = pe / pr, toward = dot(normalize(pc + 1e-4), vec2(-.7071));
        float band = smoothstep(.62, .95, q), glint = smoothstep(.55, .85, q) * (1. - smoothstep(.85, .98, q)) * smoothstep(.55, .95, toward);
        float crescent = smoothstep(.7, .92, q) * (1. - smoothstep(.92, 1., q)) * smoothstep(.3, .9, -toward);
        vec3 water = c * mix(.86, .5, band) + uSky * .1 + vec3(1.) * (glint * .55 + crescent * .28 + ring * .22);
        c = mix(c, water, pool);
      }
    } else {
      // A film of water darkens the rock and deepens its colour; it runs down the face in streaks that widen near the base.
      c = mix(vec3(lum), c, 1. + .3 * uWet) * (1. - .12 * uWet);
      float bandId = floor(vUv.x * 140.);
      float strength = fract(sin(bandId * 12.9898) * 43758.5453);
      float run = texture(uNoise, vec2(bandId / 91. + .5, vUv.y * 2.2)).r;
      float streak = smoothstep(.35, .7, strength * .85 + run * .3 - .05) * smoothstep(0., .35, fract(vUv.x * 140.)) * smoothstep(1., .65, fract(vUv.x * 140.));
      float base = .6 + .4 * vLocal.y;
      float drop = smoothstep(.82, .93, texture(uNoise, vUv * 96.).g) * (.75 + .25 * sin(uTime * .8 + strength * 40.));
      float w = uWet * mix(.35, 1., streak) * base;
      c *= 1. - w * .26;
      c += (uSky * .9 + .1) * w * (streak * .18 + drop * .55);
      // The wet skin catches the grey sky along the rock's upper curve, broken up by the grain of the stone.
      float top = smoothstep(.35, -.75, vLocal.y) * (1. - smoothstep(.55, 1., e));
      c += (uSky * .9 + .1) * uWet * top * smoothstep(.5, .78, texture(uNoise, vUv * 40.).g) * .22;
    }
  }
  // Settled snow: patchy at first, filling in from the centre as it thickens.
  float n = texture(uNoise, vUv * 7.).r * .7 + texture(uNoise, vUv * 23.).g * .3 - e * .25;
  c = mix(c, vec3(.93, .95, .98), smoothstep(.72 - .55 * snow, .82 - .5 * snow, n) * min(1., snow * 2.) * .9);
  // The same air sits over leaves and water: cloud shadow, mist, snow haze and overcast light.
  float dim = texture(uCloud, vScreen).r * uCloudShade;
  c *= 1. - dim;
  c = mix(c * vec3(1.025, 1.01, .98), vec3(dot(c, vec3(.299, .587, .114))) * vec3(.93, .99, 1.07), min(1., dim * 1.1));
  c = mix(c, uSky, uSkyK * .8);
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, uSat) * uBright * uTint;
  if (uMist > 0.) c = mix(c, uSky * uBright * 1.08, mistAt(vScreen * uView, uTime) * uMist);
  c += uFlash * (c * 1.3 + vec3(.1, .12, .16));
  vec2 v = vScreen - .5;
  c *= 1. - dot(v, v) * uVignette;
  o = vec4(c * a, a);
}`;

  // Tileable textures built on the CPU once: 4-channel value noise, and wave-slope maps from integer-frequency sines.
  function noiseData(size) {
    const d = new Uint8Array(size * size * 4);
    for (let ch = 0; ch < 4; ch++) {
      const grid = 8 << (ch & 1), lat = new Float32Array(grid * grid);
      for (let i = 0; i < lat.length; i++) lat[i] = Math.random();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let v = 0, amp = .5, tot = 0;
        for (let o = 0; o < 3; o++) {
          const g = grid << o, fx = x / size * g, fy = y / size * g, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
          const at = (a, b) => lat[((a % g) * 7 + (b % g) * 13 + o * 31) % lat.length];
          const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
          const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), e = at(ix + 1, iy + 1);
          v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy); tot += amp; amp *= .5;
        }
        d[(y * size + x) * 4 + ch] = v / tot * 255;
      }
    }
    return d;
  }
  function waveData(size) {
    const waves = [], gx = new Float32Array(size * size), gy = new Float32Array(size * size);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, k = 2 + Math.random() * 10, kx = Math.round(Math.cos(a) * k), ky = Math.round(Math.sin(a) * k);
      if (!kx && !ky) continue;
      waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.25), Math.random() * Math.PI * 2]);
    }
    let max = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, amp, ph] of waves) { const c = Math.cos((kx * x + ky * y) / size * Math.PI * 2 + ph) * amp; dx += c * kx; dy += c * ky; }
      const i = y * size + x; gx[i] = dx; gy[i] = dy; max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
    const d = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) { d[i * 4] = 127.5 + gx[i] / max * 127; d[i * 4 + 1] = 127.5 + gy[i] / max * 127; d[i * 4 + 3] = 255; }
    return d;
  }

  const STRIDE = 16;
  class Batch {
    constructor() { this.f = new Float32Array(STRIDE * 4096); this.ix = new Uint32Array(6 * 4096); this.nv = 0; this.ni = 0; }
    reset() { this.nv = 0; this.ni = 0; }
    ensure(v, i) {
      if ((this.nv + v) * STRIDE > this.f.length) { const n = new Float32Array(Math.max(this.f.length * 2, (this.nv + v) * STRIDE)); n.set(this.f); this.f = n; }
      if (this.ni + i > this.ix.length) { const n = new Uint32Array(Math.max(this.ix.length * 2, this.ni + i)); n.set(this.ix); this.ix = n; }
    }
    vert(x, y, u, v, c, fog, side = 0, width = 0, metal = 0, gloss = 0) {
      const f = this.f, o = this.nv * STRIDE;
      f[o] = x; f[o + 1] = y; f[o + 2] = u; f[o + 3] = v; f[o + 4] = c[0]; f[o + 5] = c[1]; f[o + 6] = c[2]; f[o + 7] = c[3];
      f[o + 8] = fog ? fog[0] : 0; f[o + 9] = fog ? fog[1] : 0; f[o + 10] = fog ? fog[2] : 0; f[o + 11] = fog ? fog[3] : 0;
      f[o + 12] = side; f[o + 13] = width; f[o + 14] = metal; f[o + 15] = gloss;
      return this.nv++;
    }
  }
  const WHITE = [1, 1, 1, 1];
  const LAYERS = ['shadow', 'under', 'floaters', 'surface', 'airShadow', 'air', 'glow'];

  // Shelf-pack misc sprites under the fish cells.
  function packSprites(sprites) {
    const list = Object.entries(sprites).sort((a, b) => b[1].canvas.height - a[1].canvas.height);
    let x = 4, y = MISC_Y, shelf = 0;
    for (const [, s] of list) {
      const w = s.canvas.width, h = s.canvas.height;
      if (x + w + 4 > ATLAS) { x = 4; y += shelf + 8; shelf = 0; }
      if (y + h + 4 > ATLAS) throw Error('atlas full');
      s.x = x; s.y = y; s.w = w; s.h = h; x += w + 8; shelf = Math.max(shelf, h);
      s.u0 = s.x / ATLAS; s.v0 = s.y / ATLAS; s.u1 = (s.x + w) / ATLAS; s.v1 = (s.y + h) / ATLAS;
    }
    return sprites;
  }

  // Geometry shared by both backends: world-space corners for a sprite and the koi body strip.
  function spriteCorners(def, x, y, angle, sx, sy) {
    const w = def.w / def.ppu * sx, h = def.h / def.ppu * sy, ox = -def.px * w, oy = -def.py * h, c = Math.cos(angle), s = Math.sin(angle);
    const pts = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]];
    return pts.map(([a, b]) => [x + a * c - b * s, y + a * s + b * c]);
  }

  // Fit the W×H painting to a w×h screen, cropping like CSS 'cover'. On a portrait screen the painting (a pond seen
  // from straight above) is turned a quarter clockwise, so the whole pond, lotus corners and all, fills a phone.
  // Returns image uv = (u·s, v·s) with s = (screen x / w, screen y / h, 1), and turn = quarter turns applied.
  function fitBed(W, H, w, h, allowTurn = true) {
    const turn = allowTurn && h > w * 1.15 ? 1 : 0, ia = turn ? H / W : W / H, sa = w / h;
    const r = sa > ia ? [0, (1 - ia / sa) / 2, 1, ia / sa] : [(1 - sa / ia) / 2, 0, sa / ia, 1];
    // In the turned picture (ru, rv) = (r0 + su·r2, r1 + sv·r3); turning back: image u = rv, image v = 1 − ru.
    return turn ? { u: [0, r[3], r[1]], v: [-r[2], 0, 1 - r[0]], turn } : { u: [r[2], 0, r[0]], v: [0, r[3], r[1]], turn };
  }
  function bedToScreen(bed, iu, iv, w, h) {
    const [a, b, c] = bed.u, [d, e, f] = bed.v, det = a * e - b * d, x = iu - c, y = iv - f;
    return [(e * x - b * y) / det * w, (a * y - d * x) / det * h];
  }

  function createGL(canvas, bedImage, sprites, onLost, floatMask) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
    if (!gl) return null;
    const floatRT = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    let lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; }, { once: true });
    canvas.addEventListener('webglcontextrestored', () => onLost && onLost(), { once: true });

    function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; }
    function program(vs, fs) {
      const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUv'); gl.bindAttribLocation(p, 2, 'aColor'); gl.bindAttribLocation(p, 3, 'aFog'); gl.bindAttribLocation(p, 4, 'aLight');
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      const cache = {}; p.u = n => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n)));
      return p;
    }
    const P = { drop: program(VS_QUAD, FS_DROP), sim: program(VS_QUAD, FS_SIM), caustic: program(VS_QUAD, FS_CAUSTIC), bed: program(VS_QUAD, FS_BED), sprite: program(VS_SPRITE, FS_SPRITE), surface: program(VS_QUAD, FS_SURFACE), final: program(VS_QUAD, FS_FINAL), floater: program(VS_FLOAT, FS_FLOAT), cloud: program(VS_QUAD, FS_CLOUD) };

    const quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const spriteVao = gl.createVertexArray(); gl.bindVertexArray(spriteVao);
    const vbo = gl.createBuffer(), ibo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    for (const [loc, n, off] of [[0, 2, 0], [1, 2, 8], [2, 4, 16], [3, 4, 32], [4, 4, 48]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, STRIDE * 4, off); }
    gl.bindVertexArray(null);

    function texture(w, h, internal, format, type, data, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    }
    function target(w, h, internal, format, type) {
      const tex = texture(w, h, internal, format, type), fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return ok ? { tex, fb, w, h } : null;
    }
    function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

    // Noise channels are data, not colour: keep them un-premultiplied. Sprites below are premultiplied.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const noiseTex = texture(256, 256, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, noiseData(256), gl.LINEAR, gl.REPEAT);
    const waveTex = texture(256, 256, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, waveData(256), gl.LINEAR, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const bedTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, bedTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bedImage); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const floatTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, floatTex);
    if (floatMask) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, floatMask);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const atlas = texture(ATLAS, ATLAS, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR_MIPMAP_LINEAR);
    packSprites(sprites);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    for (const s of Object.values(sprites)) gl.texSubImage2D(gl.TEXTURE_2D, 0, s.x, s.y, gl.RGBA, gl.UNSIGNED_BYTE, s.canvas);
    let atlasDirty = true;

    const state = { w: 1, h: 1, dpr: 1, quality: 'high', scene: null, shadow: null, caustic: null, surface: null, cloud: null, sim: [null, null], simW: 1, simH: 1, simAcc: 0, bed: { u: [1, 0, 0], v: [0, 1, 0], turn: 0 } };
    const drops = [];
    const batches = {}; for (const l of LAYERS) batches[l] = new Batch();

    function resize(w, h, dpr, quality) {
      Object.assign(state, { w, h, dpr, quality });
      const px = w * h * dpr * dpr, cap = quality === 'eco' ? 1.6e6 : 3.6e6, k = px > cap ? Math.sqrt(cap / px) : 1;
      canvas.width = Math.max(1, Math.round(w * dpr * k)); canvas.height = Math.max(1, Math.round(h * dpr * k));
      freeTarget(state.scene); freeTarget(state.shadow); freeTarget(state.caustic); freeTarget(state.surface); freeTarget(state.cloud); state.sim.forEach(freeTarget);
      state.scene = target(canvas.width, canvas.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      // Shadows at half resolution keep a fish's outline (a smaller target averaged thin bodies away to nothing);
      // mipmaps let the bed blur them where the light is soft.
      const sd = quality === 'eco' ? 3 : 2;
      state.shadow = target(Math.ceil(w / sd), Math.ceil(h / sd), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      gl.bindTexture(gl.TEXTURE_2D, state.shadow.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
      state.cloud = target(Math.ceil(w / 8), Math.ceil(h / 8), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const cd = quality === 'eco' ? 3 : 2;
      state.caustic = target(Math.ceil(w / cd), Math.ceil(h / cd), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      state.surface = target(Math.ceil(w / cd), Math.ceil(h / cd), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const cell = quality === 'eco' ? 4 : 3;
      state.simW = Math.min(900, Math.ceil(w / cell)); state.simH = Math.min(900, Math.ceil(h / cell));
      state.sim = floatRT ? [0, 1].map(() => target(state.simW, state.simH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)) : [null, null];
      if (!state.sim[0] || !state.sim[1]) state.sim = [null, null];
      for (const t of state.sim) if (t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      state.bed = fitBed(bedImage.width, bedImage.height, w, h);
    }
    // Map a point of the painted pond image to screen CSS pixels.
    function imageToScreen(x, y) { return bedToScreen(state.bed, x / bedImage.width, y / bedImage.height, state.w, state.h); }
    function setBed(p) { gl.uniform3fv(p.u('uBedU'), state.bed.u); gl.uniform3fv(p.u('uBedV'), state.bed.v); }

    function setFish(i, sprite) {
      if (i >= MAX_FISH) return;
      const [x, y] = cellOrigin(i);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, sprite);
      atlasDirty = true;
    }

    function drawQuad() { gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
    let lightDir = [-.45, .45, .77], lightK = 1;
    // shadowCloud: 1 for shadows cast on the water surface, which pale under a cloud; bed shadows are paled by the bed pass.
    function drawBatch(b, mode, bias, causticK, shadowCloud = 0) {
      if (!b.ni) return;
      const p = P.sprite; gl.useProgram(p);
      gl.uniform3fv(p.u('uLight'), lightDir); gl.uniform1f(p.u('uLightK'), lightK); gl.uniform1f(p.u('uShadowCloud'), shadowCloud);
      gl.uniform2f(p.u('uView'), state.w, state.h); gl.uniform1i(p.u('uMode'), mode); gl.uniform1f(p.u('uBias'), bias || 0); gl.uniform1f(p.u('uCausticK'), causticK || 0);
      bindTex(0, atlas); gl.uniform1i(p.u('uTex'), 0); bindTex(1, state.caustic.tex); gl.uniform1i(p.u('uCaustic'), 1); bindTex(2, state.cloud.tex); gl.uniform1i(p.u('uCloud'), 2);
      drawElements(b);
    }
    function drawElements(b) {
      gl.bindVertexArray(spriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, b.f.subarray(0, b.nv * STRIDE), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.ix.subarray(0, b.ni), gl.STREAM_DRAW);
      gl.drawElements(gl.TRIANGLES, b.ni, gl.UNSIGNED_INT, 0);
    }

    function render(time, dt, env) {
      if (lost || gl.isContextLost()) { for (const l of LAYERS) batches[l].reset(); drops.length = 0; return; }
      if (atlasDirty) { gl.bindTexture(gl.TEXTURE_2D, atlas); gl.generateMipmap(gl.TEXTURE_2D); atlasDirty = false; }
      lightDir = env.sun; lightK = env.sunK;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      const { w, h } = state;
      // 1. Ripples: drops, then fixed-rate wave steps.
      if (state.sim[0]) {
        gl.disable(gl.BLEND); gl.viewport(0, 0, state.simW, state.simH);
        const aspect = w / h;
        while (drops.length) {
          const batch = drops.splice(0, 24), p = P.drop, arr = new Float32Array(96);
          const minR = 2.6 * h / state.simH;
          batch.forEach((d, i) => { const r = Math.max(d[2], minR); arr.set([d[0] / w, 1 - d[1] / h, r / h, d[3] * Math.min(1, d[2] / r + .25)], i * 4); });
          gl.useProgram(p); gl.uniform4fv(p.u('uDrops'), arr); gl.uniform1i(p.u('uCount'), batch.length); gl.uniform1f(p.u('uAspect'), aspect);
          bindTex(0, state.sim[0].tex); gl.uniform1i(p.u('uState'), 0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, state.sim[1].fb); drawQuad(); state.sim.reverse();
        }
        state.simAcc = Math.min(state.simAcc + dt * 90, 4);
        const p = P.sim; gl.useProgram(p); gl.uniform2f(p.u('uTexel'), 1 / state.simW, 1 / state.simH); gl.uniform1f(p.u('uDamp'), .994); gl.uniform1f(p.u('uAspect'), aspect);
        setBed(p); bindTex(1, floatTex); gl.uniform1i(p.u('uFloat'), 1);
        while (state.simAcc >= 1) {
          state.simAcc -= 1;
          bindTex(0, state.sim[0].tex); gl.uniform1i(p.u('uState'), 0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, state.sim[1].fb); drawQuad(); state.sim.reverse();
        }
      } else drops.length = 0;
      // 2. Caustics at reduced resolution.
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.caustic.fb); gl.viewport(0, 0, state.caustic.w, state.caustic.h);
      let p = P.caustic; gl.useProgram(p);
      gl.uniform1f(p.u('uTime'), time); gl.uniform1f(p.u('uCell'), env.causticCell); gl.uniform2f(p.u('uView'), w, h);
      bindTex(0, noiseTex); gl.uniform1i(p.u('uNoise'), 0); drawQuad();
      // 3. Cloud shadows drifting over the pond: everything lit by the sun reads this.
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.cloud.fb); gl.viewport(0, 0, state.cloud.w, state.cloud.h);
      p = P.cloud; gl.useProgram(p);
      const unit = Math.max(w, h) * 4.2;
      gl.uniform2f(p.u('uView'), w, h); gl.uniform1f(p.u('uTime'), time); gl.uniform1f(p.u('uCover'), env.cloudCover); gl.uniform1f(p.u('uUnit'), unit);
      gl.uniform2f(p.u('uWind'), env.cloudWind[0] / unit, env.cloudWind[1] / unit);
      bindTex(0, noiseTex); gl.uniform1i(p.u('uNoise'), 0); drawQuad();
      // 4. Shadows cast on the bed.
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.shadow.fb); gl.viewport(0, 0, state.shadow.w, state.shadow.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawBatch(batches.shadow, 1, .15, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, state.shadow.tex); gl.generateMipmap(gl.TEXTURE_2D);
      // 5. Underwater scene: bed, then creatures.
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.scene.fb); gl.viewport(0, 0, state.scene.w, state.scene.h);
      p = P.bed; gl.useProgram(p);
      setBed(p);
      gl.uniform1f(p.u('uCausticK'), env.caustic); gl.uniform1f(p.u('uShadowK'), env.shadow); gl.uniform3fv(p.u('uCausticTint'), env.causticTint);
      const fo = 11 * Math.min(1.2, Math.min(w, h) / 800);
      const bu = state.bed.u, bv = state.bed.v, sx = env.shadowDir[0] * fo / w, sy = env.shadowDir[1] * fo / h;
      gl.uniform2f(p.u('uFloatShift'), bu[0] * sx + bu[1] * sy, bv[0] * sx + bv[1] * sy);
      gl.uniform2f(p.u('uShadowTexel'), 1 / state.shadow.w, 1 / state.shadow.h);
      bindTex(0, bedTex); gl.uniform1i(p.u('uBed'), 0); bindTex(1, state.shadow.tex); gl.uniform1i(p.u('uShadow'), 1); bindTex(2, state.caustic.tex); gl.uniform1i(p.u('uCaustic'), 2); bindTex(3, floatTex); gl.uniform1i(p.u('uFloat'), 3);
      bindTex(4, state.cloud.tex); gl.uniform1i(p.u('uCloud'), 4);
      drawQuad();
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawBatch(batches.under, 0, -.9, env.caustic * .35);  // sharper mip: keeps the koi's scales readable at pond size
      // 6. Water surface: slopes and glitter at reduced resolution, then refraction, sky and grading at full.
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.surface.fb); gl.viewport(0, 0, state.surface.w, state.surface.h);
      p = P.surface; gl.useProgram(p);
      gl.uniform2f(p.u('uView'), w, h); gl.uniform2f(p.u('uSimTexel'), 1 / state.simW, 1 / state.simH); gl.uniform1f(p.u('uTime'), time);
      gl.uniform1f(p.u('uRipple'), state.sim[0] ? env.ripple : 0); gl.uniform1f(p.u('uWaveAmp'), env.wave); gl.uniform3fv(p.u('uSun'), env.sun);
      bindTex(0, state.sim[0] ? state.sim[0].tex : noiseTex); gl.uniform1i(p.u('uHeight'), 0); bindTex(1, waveTex); gl.uniform1i(p.u('uWaves'), 1); bindTex(2, noiseTex); gl.uniform1i(p.u('uNoise'), 2);
      drawQuad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      p = P.final; gl.useProgram(p);
      gl.uniform2f(p.u('uView'), w, h); gl.uniform1f(p.u('uRefract'), env.refract); gl.uniform1f(p.u('uGlint'), env.glint); gl.uniform1f(p.u('uSkyK'), env.skyK);
      gl.uniform1f(p.u('uVignette'), env.vignette); gl.uniform1f(p.u('uMoon'), env.moon); gl.uniform1f(p.u('uBright'), env.bright); gl.uniform1f(p.u('uSat'), env.sat); gl.uniform1f(p.u('uShade'), env.shade);
      gl.uniform3fv(p.u('uGlintColor'), env.glintColor); gl.uniform3fv(p.u('uSky'), env.sky); gl.uniform3fv(p.u('uTint'), env.tint); gl.uniform3fv(p.u('uSun'), env.sun);
      gl.uniform1f(p.u('uCloudShade'), env.cloudShade); gl.uniform1f(p.u('uMist'), env.mist || 0); gl.uniform1f(p.u('uFlash'), env.flash || 0);
      setBed(p); gl.uniform4fv(p.u('uMoonDisc'), env.moonDisc); gl.uniform1f(p.u('uTime'), time);
      bindTex(0, state.scene.tex); gl.uniform1i(p.u('uScene'), 0); bindTex(1, state.surface.tex); gl.uniform1i(p.u('uSurface'), 1);
      bindTex(2, noiseTex); gl.uniform1i(p.u('uNoise'), 2); bindTex(3, floatTex); gl.uniform1i(p.u('uFloat'), 3); bindTex(4, state.cloud.tex); gl.uniform1i(p.u('uCloud'), 4);
      drawQuad();
      // Leaves and flowers above the water.
      if (batches.floaters.ni) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        p = P.floater; gl.useProgram(p);
        gl.uniform2f(p.u('uView'), w, h); gl.uniform1f(p.u('uBright'), env.bright); gl.uniform1f(p.u('uSat'), env.sat); gl.uniform1f(p.u('uVignette'), env.vignette); gl.uniform1f(p.u('uShade'), env.shade); gl.uniform3fv(p.u('uTint'), env.tint);
        gl.uniform1f(p.u('uSnow'), env.snowCover || 0); gl.uniform1f(p.u('uSkyK'), env.skyK); gl.uniform3fv(p.u('uSky'), env.sky);
        gl.uniform1f(p.u('uWet'), env.wetCover || 0); gl.uniform1f(p.u('uRain'), env.rainK || 0); gl.uniform1f(p.u('uTime'), time); gl.uniform1f(p.u('uCloudShade'), env.cloudShade);
        gl.uniform1f(p.u('uMist'), env.mist || 0); gl.uniform1f(p.u('uFlash'), env.flash || 0);
        bindTex(0, bedTex); gl.uniform1i(p.u('uBed'), 0); bindTex(1, state.surface.tex); gl.uniform1i(p.u('uSurface'), 1); bindTex(2, noiseTex); gl.uniform1i(p.u('uNoise'), 2); bindTex(3, state.cloud.tex); gl.uniform1i(p.u('uCloud'), 3);
        drawElements(batches.floaters);
      }
      // 7. Things on and above the surface.
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawBatch(batches.surface, 0, 0, 0);
      drawBatch(batches.airShadow, 1, 2.6, 0, 1);
      drawBatch(batches.air, 0, -.2, 0);
      gl.blendFunc(gl.ONE, gl.ONE);
      drawBatch(batches.glow, 2, 0, 0);
      for (const l of LAYERS) batches[l].reset();
    }

    const api = {
      kind: 'webgl2', ripples: !!floatRT, sprites, resize, imageToScreen, setFish, render,
      drop(x, y, r, s) { if (drops.length < 96) drops.push([x, y, r, s]); },
      // One leaf, flower or rock from the painting (image px ellipse), turned by angle and moved by (dx, dy) screen px.
      floater(ix, iy, irx, iry, rot, angle, dx, dy, push, snowK = 1, wetKind = 1, pool = 0, seed = 0) {
        const b = batches.floaters, W = bedImage.width, H = bedImage.height, [sx, sy] = imageToScreen(ix, iy), m = 1.08;
        const [x0, y0] = imageToScreen(0, 0), [x1, y1] = imageToScreen(1, 0), k = Math.hypot(x1 - x0, y1 - y0), turn = state.bed.turn * Math.PI / 2;
        const cr = Math.cos(rot), sr = Math.sin(rot), ca = Math.cos(rot + angle + turn), sa = Math.sin(rot + angle + turn), n = b.nv, pr = Math.max(irx, iry) * k + 3;
        const probe = [sx / state.w, 1 - sy / state.h, pr / state.w, pr / state.h];
        b.ensure(4, 6);
        for (const [lx, ly] of [[-m, -m], [m, -m], [m, m], [-m, m]]) {
          const ex = lx * irx, ey = ly * iry;
          b.vert(sx + dx + (ex * ca - ey * sa) * k, sy + dy + (ex * sa + ey * ca) * k, (ix + ex * cr - ey * sr) / W, (iy + ex * sr + ey * cr) / H, [lx, ly, push, snowK], probe, wetKind, pool, seed);
        }
        b.ix.set([n, n + 1, n + 2, n, n + 2, n + 3], b.ni); b.ni += 6;
      },
      sprite(layer, def, x, y, angle, sx, sy, color = WHITE, fog) {
        const b = batches[layer]; b.ensure(4, 6);
        const c = spriteCorners(def, x, y, angle, sx, sy), n = b.nv;
        b.vert(c[0][0], c[0][1], def.u0, def.v0, color, fog); b.vert(c[1][0], c[1][1], def.u1, def.v0, color, fog);
        b.vert(c[2][0], c[2][1], def.u1, def.v1, color, fog); b.vert(c[3][0], c[3][1], def.u0, def.v1, color, fog);
        b.ix.set([n, n + 1, n + 2, n, n + 2, n + 3], b.ni); b.ni += 6;
      },
      // Koi body strip along the posed spine; pose from PondCore.fishPose, k scales about (cx, cy) for depth.
      // light: { widths: body half-width / strip half-height per spine point, metal, gloss } for relighting.
      fish(layer, cell, pose, s, cx, cy, k, color = WHITE, fog, dx = 0, dy = 0, light) {
        if (cell >= MAX_FISH) return;
        const b = batches[layer], n = BODY.segments, [ox, oy] = cellOrigin(cell), hh = BODY.half * s * k;
        const v0 = oy / ATLAS, v1 = (oy + CELL_H) / ATLAS, u0 = ox / ATLAS, du = CELL_W / ATLAS;
        b.ensure((n + 3) * 2, (n + 2) * 6);
        const first = b.nv;
        for (let j = -1; j <= n + 1; j++) {
          const i = Math.max(0, Math.min(n, j));
          let px = pose[i * 4], py = pose[i * 4 + 1];
          const nx = pose[i * 4 + 2], ny = pose[i * 4 + 3];
          if (j === -1 || j === n + 1) { const sgn = j < 0 ? 1 : -1; px += ny * 2 * s * sgn; py -= nx * 2 * s * sgn; }
          const lx = j === -1 ? 36 : j === n + 1 ? -60 : BODY.nose - i * SEG_UNITS, u = u0 + (lx - BODY.left) / BODY.width * du;
          const X = cx + (px - cx) * k + dx, Y = cy + (py - cy) * k + dy;
          const wn = light && j >= 0 && j <= n ? light.widths[i] : 0, m = light ? light.metal : 0, gs = light ? light.gloss : 0;
          b.vert(X - nx * hh, Y - ny * hh, u, v0, color, fog, -1, wn, m, gs); b.vert(X + nx * hh, Y + ny * hh, u, v1, color, fog, 1, wn, m, gs);
        }
        for (let j = 0; j < n + 2; j++) { const a = first + j * 2; b.ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], b.ni); b.ni += 6; }
      }
    };
    return api;
  }

  // Draw a koi sprite along a posed spine with Canvas 2D, one slice per segment.
  function drawStrip2D(ctx, img, pose, s, cx, cy, k) {
    const n = BODY.segments, hh = BODY.half * s * k, ppu = img.width / BODY.width;
    for (let i = 0; i < n; i++) {
      const ax = cx + (pose[i * 4] - cx) * k, ay = cy + (pose[i * 4 + 1] - cy) * k, bx = cx + (pose[i * 4 + 4] - cx) * k, by = cy + (pose[i * 4 + 5] - cy) * k;
      const len = Math.hypot(bx - ax, by - ay), sx = (BODY.nose - (i + 1) * SEG_UNITS - BODY.left) * ppu, head = i === 0 ? 2 : 0;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(ay - by, ax - bx));
      ctx.drawImage(img, sx, 0, (SEG_UNITS + head) * ppu, img.height, 0, -hh, len + head * s * k + .6, hh * 2);
      if (i === n - 1) ctx.drawImage(img, 0, 0, 2 * ppu, img.height, -2 * s * k, -hh, 2 * s * k + .4, hh * 2);
      ctx.restore();
    }
  }

  // ---------- Canvas 2D fallback ----------
  function create2D(canvas, bedImage, sprites) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const state = { w: 1, h: 1, dpr: 1, bed: { u: [1, 0, 0], v: [0, 1, 0], turn: 0 } }, fishCanvases = [], rings = [], queue = {};
    for (const l of LAYERS) queue[l] = [];
    return {
      kind: '2d', ripples: false, sprites,
      resize(w, h, dpr) {
        Object.assign(state, { w, h, dpr: Math.min(dpr, 1.5) });
        canvas.width = Math.round(w * state.dpr); canvas.height = Math.round(h * state.dpr);
        // The CSS backdrop behind this canvas is a plain centred cover crop, so the painting is never turned here.
        state.bed = fitBed(bedImage.width, bedImage.height, w, h, false);
      },
      imageToScreen(x, y) { return bedToScreen(state.bed, x / bedImage.width, y / bedImage.height, state.w, state.h); },
      setFish(i, sprite) { const c = fishCanvases[i] || (fishCanvases[i] = document.createElement('canvas')); c.width = sprite.width; c.height = sprite.height; c.getContext('2d').drawImage(sprite, 0, 0); },
      drop(x, y, r, s) { if (s > .05 && rings.length < 60) rings.push({ x, y, age: 0, max: 1 + Math.min(2, s * 3) }); },
      floater() {},
      sprite(layer, def, x, y, angle, sx, sy, color = WHITE) { if (layer !== 'shadow' && layer !== 'airShadow') queue[layer].push(['s', def, x, y, angle, sx, sy, color[3]]); },
      fish(layer, cell, pose, s, cx, cy, k, color = WHITE) { if (layer === 'under' && fishCanvases[cell]) queue[layer].push(['f', fishCanvases[cell], Float32Array.from(pose), s, cx, cy, k, color[3]]); },
      render(time, dt) {
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); ctx.clearRect(0, 0, state.w, state.h);
        for (const l of LAYERS) {
          ctx.globalCompositeOperation = l === 'glow' ? 'lighter' : 'source-over';
          for (const q of queue[l]) {
            ctx.globalAlpha = q[q.length - 1];
            if (q[0] === 's') {
              const [, def, x, y, angle, sx, sy] = q;
              ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(sx / def.ppu, sy / def.ppu);
              ctx.drawImage(def.canvas, -def.px * def.canvas.width, -def.py * def.canvas.height); ctx.restore();
            } else drawStrip2D(ctx, q[1], q[2], q[3], q[4], q[5], q[6]);
          }
          queue[l].length = 0;
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        for (const r of rings) { r.age += dt; const f = Math.max(0, 1 - r.age / r.max), rad = 4 + r.age * 60; ctx.strokeStyle = `rgba(244,250,228,${f * .5})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * .92, 0, 0, Math.PI * 2); ctx.stroke(); }
        for (let i = rings.length - 1; i >= 0; i--) if (rings[i].age > rings[i].max) rings.splice(i, 1);
      }
    };
  }

  // Returns the renderer and the canvas it drew on (a fresh one if WebGL grabbed the original and then failed).
  function createRenderer(canvas, bedImage, sprites, onLost, floatMask) {
    try { const r = createGL(canvas, bedImage, sprites, onLost, floatMask); if (r) return Object.assign(r, { canvas }); } catch (e) { console.warn('WebGL2 pond unavailable, using 2D', e); }
    let target = canvas, r = create2D(target, bedImage, sprites);
    if (!r) { target = canvas.cloneNode(); canvas.replaceWith(target); r = create2D(target, bedImage, sprites); }
    return r && Object.assign(r, { canvas: target });
  }
  root.PondGL = { createRenderer, drawStrip2D, fitBed, bedToScreen, FISH_PPU, MAX_FISH };
})(window);
