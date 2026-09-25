const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../core.js');
const context = { window: { PondCore: core }, ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } } };
vm.runInNewContext(fs.readFileSync(require.resolve('../art.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(require.resolve('../scene.js'), 'utf8'), context);
const { PondScene, lookFor } = context.window.PondScene;

// A stand-in renderer: the painting maps 1:1 onto a 1672×941 screen.
function pond(seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const R = { drops: [], imageToScreen: (x, y) => [x, y], drop(...a) { this.drops.push(a); } };
  const sim = new core.PondSimulation([core.createFish(0, rnd)], 1672, 941, rnd, [], false);
  const scene = new PondScene(R, sim, rnd); scene.layout(1672, 941);
  return scene;
}
const base = { turtles: false, butterflies: false, night: false, rainAmount: .9, snowAmount: .5 };

test('每种天气与夜色的画面参数键一致，天气切换可平滑过渡', () => {
  const keys = Object.keys(lookFor('sunny', false)).sort();
  for (const w of ['sunny', 'cloudy', 'rain', 'snow']) for (const night of [false, true]) assert.deepEqual(Object.keys(lookFor(w, night)).sort(), keys);
});

test('云量：晴天偶有云影，多云约半池云影，雨天满天阴云', () => {
  const cover = w => lookFor(w, false).cloudCover;
  assert.ok(cover('sunny') < .3 && cover('cloudy') > .4 && cover('cloudy') < .7 && cover('rain') === 1);
  assert.ok(lookFor('cloudy', false).caustic > lookFor('rain', false).caustic * 3, '多云时云隙阳光仍有焦散');
});

test('雨点打在荷叶、花苞上会溅起水花并让它们颤动，雨停后回稳', () => {
  const scene = pond();
  for (let i = 0; i < 90; i++) scene.update(1 / 30, { ...base, weather: 'rain' });
  assert.ok(scene.splashes.some(p => p.leaf), '荷叶上有雨滴水花');
  assert.ok(scene.floaters.some(f => f.ja !== 0 || f.ox !== 0), '有荷叶或花苞被雨点碰动');
  for (let i = 0; i < 600; i++) scene.update(1 / 30, { ...base, weather: 'sunny' });
  assert.ok(scene.floaters.every(f => Math.abs(f.ja) < .01 && Math.abs(f.ox) < .05 && Math.abs(f.oy) < .05));
  assert.equal(scene.splashes.length, 0);
});

test('大雨偶有闪电，闪光后发出雷声事件；小雨与晴天没有', () => {
  const scene = pond(3); let flashes = 0;
  for (let i = 0; i < 30 * 200; i++) { scene.update(1 / 30, { ...base, weather: 'rain' }); if (scene.look.flash > .05) flashes++; }
  const thunder = scene.events.filter(e => e.type === 'thunder');
  assert.ok(thunder.length >= 2 && thunder.length <= 12, `200 秒内雷声 ${thunder.length} 次`);
  assert.ok(flashes > 0 && thunder.every(e => e.delay >= 1 && e.delay <= 3.5));
  const calm = pond(4); calm.events.length = 0;
  for (let i = 0; i < 30 * 120; i++) calm.update(1 / 30, { ...base, weather: 'rain', rainAmount: .3 });
  assert.equal(calm.events.length, 0);
});
