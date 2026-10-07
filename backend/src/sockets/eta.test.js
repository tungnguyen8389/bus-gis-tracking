const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLine, haversineM } = require("./route-geometry");
const {
  vnSecondsOfDay, vnMidnightMs, isPublicTrip, vehicleSpeedKmh, averageSpeedKmh, tripEta,
  MIN_SPEED_KMH, MAX_SPEED_KMH, DEFAULT_SPEED_KMH
} = require("./eta");

const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const H = 3600;
const LAT = 10.8;
const line = buildLine([[106.70, LAT], [106.74, LAT]]);
const at = (lon, t) => ({ t, longitude: lon, latitude: LAT });
const trip = (samples, extra = {}) => ({ samples, last_position: null, speed_sum: 0, speed_count: 0, ...extra });

test("giờ VN: 03:00 UTC = 10:00, nửa đêm VN đúng", () => {
  assert.equal(vnSecondsOfDay(VN_10H), 10 * H);
  assert.equal(vnMidnightMs(VN_10H), VN_10H - 10 * H * 1000);
  assert.equal(vnSecondsOfDay(Date.UTC(2026, 9, 5, 17, 30, 0)), 30 * 60);   // 00:30 VN hôm sau
});

test("isPublicTrip: biên −15 phút / +2 giờ; đang chạy luôn công khai", () => {
  assert.equal(isPublicTrip(10 * H - 15 * 60, VN_10H, false), true);
  assert.equal(isPublicTrip(10 * H - 15 * 60 - 1, VN_10H, false), false);
  assert.equal(isPublicTrip(12 * H, VN_10H, false), true);
  assert.equal(isPublicTrip(12 * H + 1, VN_10H, false), false);
  assert.equal(isPublicTrip(5 * H, VN_10H, true), true);
});

test("vehicleSpeedKmh: quãng đường dọc tuyến trong cửa sổ mẫu", () => {
  // 0.01° kinh độ ≈ 1093 m trong 180 s ≈ 21.9 km/h
  const v = vehicleSpeedKmh(trip([at(106.70, 0), at(106.705, 90_000), at(106.71, 180_000)]), line);
  const expected = haversineM([106.70, LAT], [106.71, LAT]) / 180 * 3.6;
  assert.ok(Math.abs(v - expected) < 0.5, `${v} ≠ ${expected}`);
});

test("vehicleSpeedKmh: last_position mới hơn mẫu cuối được tính là điểm mới nhất", () => {
  const v = vehicleSpeedKmh(trip([at(106.70, 0)], { last_position: at(106.71, 180_000) }), line);
  assert.ok(v > 20 && v < 23);
});

test("vehicleSpeedKmh: chưa đủ 2 phút → trung bình speed_kmh; không có gì → mặc định", () => {
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.71, 60_000)], { speed_sum: 70, speed_count: 2 }), line), 35);
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0)]), line), DEFAULT_SPEED_KMH);
  assert.equal(vehicleSpeedKmh(trip([], { speed_sum: 50, speed_count: 2 }), null), 25);
});

test("vehicleSpeedKmh: kẹp trong [5, 60]", () => {
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.70, 300_000)]), line), MIN_SPEED_KMH);
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.74, 120_000)]), line), MAX_SPEED_KMH);
});

test("vehicleSpeedKmh: xe quay về đầu tuyến → chỉ dùng mẫu sau điểm tụt", () => {
  // Xe tới cuối tuyến (106.74) rồi xuất hiện lại ở đầu tuyến (106.70)
  const samples = [at(106.73, 0), at(106.74, 60_000), at(106.70, 120_000), at(106.705, 180_000), at(106.71, 300_000)];
  const v = vehicleSpeedKmh(trip(samples), line);
  // sau điểm tụt: 106.70 → 106.71 trong 180 s
  const expected = haversineM([106.70, LAT], [106.71, LAT]) / 180 * 3.6;
  assert.ok(Math.abs(v - expected) < 0.5, `${v} ≠ ${expected}`);
});

test("vehicleSpeedKmh: sau điểm tụt chưa đủ 2 phút → dự phòng speed_kmh", () => {
  const samples = [at(106.73, 0), at(106.74, 120_000), at(106.70, 180_000), at(106.705, 240_000)];
  assert.equal(vehicleSpeedKmh(trip(samples, { speed_sum: 30, speed_count: 1 }), line), 30);
});

test("averageSpeedKmh: trung bình, rỗng → mặc định", () => {
  assert.equal(averageSpeedKmh([20, 30]), 25);
  assert.equal(averageSpeedKmh([]), DEFAULT_SPEED_KMH);
});

test("tripEta: đang chạy chưa tới trạm → now + còn lại / v", () => {
  const r = tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 2000, vehicleM: 1000, speedKmh: 36 });
  assert.deepEqual(r, { status: "RUNNING", etaMs: VN_10H + 100_000 });
});

test("tripEta: đang chạy đã qua trạm quá 30 m → PASSED", () => {
  assert.deepEqual(
    tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 1000, vehicleM: 1031, speedKmh: 20 }),
    { status: "PASSED", etaMs: null }
  );
  assert.equal(tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 1000, vehicleM: 1020, speedKmh: 36 }).etaMs, VN_10H);
});

test("tripEta: sắp tới → giờ xuất bến + quãng tới trạm / v", () => {
  const r = tripEta({ running: false, depSec: 10 * H + 15 * 60, nowMs: VN_10H, boardM: 3600, vehicleM: 0, speedKmh: 36 });
  assert.deepEqual(r, { status: "UPCOMING", etaMs: VN_10H + 15 * 60 * 1000 + 360_000 });
});

test("tripEta: chuyến trễ chưa xuất bến → tính như xuất bến ngay bây giờ", () => {
  const r = tripEta({ running: false, depSec: 9 * H + 50 * 60, nowMs: VN_10H, boardM: 3600, vehicleM: 0, speedKmh: 36 });
  assert.deepEqual(r, { status: "UPCOMING", etaMs: VN_10H + 360_000 });
});

test("tripEta: không có trạm lên → không ETA, giữ trạng thái", () => {
  assert.deepEqual(tripEta({ running: true, depSec: 0, nowMs: VN_10H, boardM: undefined, vehicleM: 5000, speedKmh: 20 }), { status: "RUNNING", etaMs: null });
  assert.deepEqual(tripEta({ running: false, depSec: 0, nowMs: VN_10H, boardM: undefined, vehicleM: 0, speedKmh: 20 }), { status: "UPCOMING", etaMs: null });
});
