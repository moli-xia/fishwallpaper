const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../core.js');
const context = { window: { PondCore: core } };
vm.runInNewContext(fs.readFileSync(require.resolve('../gl.js'), 'utf8'), context);
const { fitBed, bedToScreen } = context.window.PondGL;
const W = 1672, H = 941;
const toImage = (bed, sx, sy, w, h) => { const s = [sx / w, sy / h, 1], d = (r) => r[0] * s[0] + r[1] * s[1] + r[2] * s[2]; return [d(bed.u), d(bed.v)]; };

for (const [w, h, turned] of [[1280, 720, 0], [1920, 1200, 0], [412, 915, 1], [390, 844, 1], [768, 1024, 1], [1000, 1000, 0]]) {
  test(`${w}×${h}：底图${turned ? '转四分之一' : '不转'}，铺满屏幕且与屏幕坐标互逆`, () => {
    const bed = fitBed(W, H, w, h);
    assert.equal(bed.turn, turned);
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h], [w * .3, h * .7]]) {
      const [iu, iv] = toImage(bed, sx, sy, w, h);
      assert.ok(iu > -1e-9 && iu < 1 + 1e-9 && iv > -1e-9 && iv < 1 + 1e-9, '屏幕每一点都落在底图内，没有空边');
      const [x, y] = bedToScreen(bed, iu, iv, w, h);
      assert.ok(Math.abs(x - sx) < 1e-6 && Math.abs(y - sy) < 1e-6);
    }
  });
}

test('竖屏手机能看到两侧的荷花丛（横屏裁切只剩中间一条水面）', () => {
  const w = 412, h = 915, lotus = [[67, 655], [201, 826], [1565, 147], [1579, 395]];
  const visible = bed => lotus.filter(([x, y]) => { const [sx, sy] = bedToScreen(bed, x / W, y / H, w, h); return sx >= 0 && sx <= w && sy >= 0 && sy <= h; }).length;
  assert.equal(visible(fitBed(W, H, w, h, false)), 0);
  assert.ok(visible(fitBed(W, H, w, h)) >= 3);
});
