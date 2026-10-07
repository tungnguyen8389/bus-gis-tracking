const test = require("node:test");
const assert = require("node:assert/strict");
const { createTrackingLog } = require("./tracking-log");

const packet = (vehicle_id = "DRV_01") => ({ vehicle_id, longitude: 106.8, latitude: 10.87, speed_kmh: 30, heading: 90 });

function setup({ fail = false } = {}) {
  const clock = { t: 100000 };
  const queries = [];
  const errors = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (fail) throw new Error("FK fail");
      return [{ affectedRows: 1 }];
    }
  };
  const log = createTrackingLog(db, { now: () => clock.t, logError: (...a) => errors.push(a) });
  return { clock, queries, errors, log };
}

test("ghi lần đầu với WKT POINT(lon lat)", async () => {
  const { log, queries } = setup();
  assert.equal(await log.record(packet()), true);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["DRV_01", 30, 90, "POINT(106.8 10.87)"]);
});

test("cùng xe trong vòng 5s bị bỏ, sau 5s ghi tiếp", async () => {
  const { log, queries, clock } = setup();
  await log.record(packet());
  clock.t += 4999;
  assert.equal(await log.record(packet()), false);
  clock.t += 1;
  assert.equal(await log.record(packet()), true);
  assert.equal(queries.length, 2);
});

test("các xe khác nhau throttle độc lập", async () => {
  const { log, queries } = setup();
  await log.record(packet("DRV_01"));
  await log.record(packet("DRV_02"));
  assert.equal(queries.length, 2);
});

test("lỗi DB: không throw, log lỗi tối đa 1 lần / 30s / xe", async () => {
  const { log, errors, clock } = setup({ fail: true });
  assert.equal(await log.record(packet()), false);
  clock.t += 5000;
  await log.record(packet());
  assert.equal(errors.length, 1);
  clock.t += 25000;
  await log.record(packet());
  assert.equal(errors.length, 2);
});
