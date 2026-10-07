const test = require("node:test");
const assert = require("node:assert/strict");
const { validateGpsPing } = require("./gps.validate");

const valid = { latitude: 10.87, longitude: 106.8, speed_kmh: 35, heading: 90 };

test("gói hợp lệ trả đúng 4 trường", () => {
  assert.deepEqual(validateGpsPing(valid), { ok: true, value: valid });
});

test("bỏ trường thừa — client không tự khai vehicle_id/route", () => {
  const r = validateGpsPing({ ...valid, vehicle_id: "DRV_99", route_id: "X", timestamp: "fake" });
  assert.deepEqual(r.value, valid);
});

test("thiếu speed/heading thì mặc định 0", () => {
  const r = validateGpsPing({ latitude: 10.87, longitude: 106.8 });
  assert.deepEqual(r.value, { latitude: 10.87, longitude: 106.8, speed_kmh: 0, heading: 0 });
});

test("speed/heading null (GPS điện thoại đứng yên) thì mặc định 0", () => {
  const r = validateGpsPing({ latitude: 10.87, longitude: 106.8, speed_kmh: null, heading: null });
  assert.equal(r.ok, true);
  assert.equal(r.value.speed_kmh, 0);
  assert.equal(r.value.heading, 0);
});

test("không phải object", () => {
  assert.deepEqual(validateGpsPing(null), { ok: false, reason: "NOT_OBJECT" });
  assert.deepEqual(validateGpsPing("10,106"), { ok: false, reason: "NOT_OBJECT" });
});

test("latitude thiếu, ngoài khoảng, NaN", () => {
  assert.equal(validateGpsPing({ longitude: 106.8 }).reason, "BAD_LATITUDE");
  assert.equal(validateGpsPing({ ...valid, latitude: 999 }).reason, "BAD_LATITUDE");
  assert.equal(validateGpsPing({ ...valid, latitude: NaN }).reason, "BAD_LATITUDE");
});

test("longitude dạng chuỗi bị từ chối", () => {
  assert.equal(validateGpsPing({ ...valid, longitude: "106.8" }).reason, "BAD_LONGITUDE");
  assert.equal(validateGpsPing({ ...valid, longitude: 181 }).reason, "BAD_LONGITUDE");
});

test("speed âm hoặc > 200", () => {
  assert.equal(validateGpsPing({ ...valid, speed_kmh: -1 }).reason, "BAD_SPEED");
  assert.equal(validateGpsPing({ ...valid, speed_kmh: 201 }).reason, "BAD_SPEED");
});

test("heading biên: 0 và 359.9 hợp lệ, 360 và -1 bị từ chối", () => {
  assert.equal(validateGpsPing({ ...valid, heading: 0 }).ok, true);
  assert.equal(validateGpsPing({ ...valid, heading: 359.9 }).ok, true);
  assert.equal(validateGpsPing({ ...valid, heading: 360 }).reason, "BAD_HEADING");
  assert.equal(validateGpsPing({ ...valid, heading: -1 }).reason, "BAD_HEADING");
});
