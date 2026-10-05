const test = require("node:test");
const assert = require("node:assert/strict");
const { createTripRegistry } = require("./trip-registry");

const TRIP = { schedule_id: 11, vehicle_id: "DRV_01", route_id: "R1", direction: 1 };
const setup = () => {
  const clock = { t: 1_000_000 };
  const registry = createTripRegistry({ now: () => clock.t });
  const changes = [];
  registry.on("change", c => changes.push(c));
  return { clock, registry, changes };
};
const ping = (lon, speed = 30) => ({ longitude: lon, latitude: 10.8, speed_kmh: speed });

test("start/end phát change; start lại cùng chuyến không phát, không reset", () => {
  const { registry, changes } = setup();
  registry.start(TRIP);
  registry.recordPing(11, ping(106.7));
  const before = registry.get(11);
  registry.start(TRIP);
  assert.equal(registry.get(11), before);
  assert.deepEqual(changes, [{ route_id: "R1", direction: 1 }]);
  registry.end(11);
  registry.end(11);
  assert.equal(registry.has(11), false);
  assert.equal(changes.length, 2);
});

test("recordPing: last_position luôn cập nhật, mẫu mỗi 15 s, giữ cửa sổ 5 phút", () => {
  const { clock, registry } = setup();
  registry.start(TRIP);
  registry.recordPing(11, ping(106.70));
  clock.t += 10_000;
  registry.recordPing(11, ping(106.71));
  assert.equal(registry.get(11).samples.length, 1);
  assert.equal(registry.get(11).last_position.longitude, 106.71);
  clock.t += 5_000;
  registry.recordPing(11, ping(106.72));
  assert.equal(registry.get(11).samples.length, 2);

  for (let i = 0; i < 30; i++) { clock.t += 15_000; registry.recordPing(11, ping(106.72)); }
  const { samples } = registry.get(11);
  assert.ok(clock.t - samples[0].t <= 300_000);
  assert.equal(samples[samples.length - 1].t, clock.t);
});

test("recordPing: chỉ cộng speed_kmh > 0; chuyến không tồn tại bị bỏ qua", () => {
  const { registry } = setup();
  registry.recordPing(99, ping(106.7));
  registry.start(TRIP);
  registry.recordPing(11, ping(106.7, 0));
  registry.recordPing(11, ping(106.7, 40));
  assert.equal(registry.get(11).speed_sum, 40);
  assert.equal(registry.get(11).speed_count, 1);
});

test("listByRoute: lọc theo tuyến, chiều tùy chọn", () => {
  const { registry } = setup();
  registry.start(TRIP);
  registry.start({ ...TRIP, schedule_id: 12, vehicle_id: "DRV_02", direction: 2 });
  registry.start({ ...TRIP, schedule_id: 13, vehicle_id: "DRV_03", route_id: "R2" });
  assert.deepEqual(registry.listByRoute("R1").map(t => t.schedule_id), [11, 12]);
  assert.deepEqual(registry.listByRoute("R1", 2).map(t => t.schedule_id), [12]);
});
