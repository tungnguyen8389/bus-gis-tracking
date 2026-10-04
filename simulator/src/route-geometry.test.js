const test = require("node:test");
const assert = require("node:assert/strict");
const { processRouteGeometry, getInterpolatedPosition, getDistanceMeters } = require("./route-geometry");

// Đoạn 1 đi về phía đông, đoạn 2 đi về phía bắc
const COORDS = [[106.0, 10.0], [106.001, 10.0], [106.001, 10.001]];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("dưới 2 điểm → null", () => {
  assert.equal(processRouteGeometry([[106, 10]]), null);
  assert.equal(processRouteGeometry(null), null);
});

test("tổng quãng đường bằng tổng các đoạn", () => {
  const r = processRouteGeometry(COORDS);
  const expected = getDistanceMeters(COORDS[0], COORDS[1]) + getDistanceMeters(COORDS[1], COORDS[2]);
  assert.ok(near(r.totalDist, expected, 1e-6));
  assert.ok(r.totalDist > 200 && r.totalDist < 230);
});

test("tại 0 m: điểm đầu, hướng đông (90°)", () => {
  const p = getInterpolatedPosition(processRouteGeometry(COORDS), 0);
  assert.deepEqual(p, { longitude: 106.0, latitude: 10.0, heading: 90 });
});

test("giữa đoạn đầu: nội suy tuyến tính", () => {
  const r = processRouteGeometry(COORDS);
  const p = getInterpolatedPosition(r, r.segments[0].dist / 2);
  assert.ok(near(p.longitude, 106.0005));
  assert.ok(near(p.latitude, 10.0));
});

test("vượt tổng quãng đường thì quấn về đầu tuyến", () => {
  const r = processRouteGeometry(COORDS);
  const a = getInterpolatedPosition(r, 10);
  const b = getInterpolatedPosition(r, r.totalDist + 10);
  assert.ok(near(a.longitude, b.longitude) && near(a.latitude, b.latitude));
});

test("hướng gần 360° được chuẩn hóa về [0, 360) — server từ chối heading = 360", () => {
  // Đi gần như chính bắc, lệch tây rất nhỏ → atan2 cho ~359.97°, toFixed(1) sẽ ra "360.0"
  const r = processRouteGeometry([[106.0, 10.0], [105.9999995, 10.001]]);
  const { heading } = getInterpolatedPosition(r, 1);
  assert.ok(heading >= 0 && heading < 360, `heading = ${heading}`);
});
