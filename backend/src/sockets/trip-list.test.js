const test = require("node:test");
const assert = require("node:assert/strict");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const LAT = 10.8;
const hms = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;

// R1 chiều 1: đường thẳng 106.70 → 106.74, trạm S1/S2/S3; R2 không có lộ trình
const SCHEDULES = [
  { schedule_id: 101, route_id: "R1", direction: 1, dep_sec: 9.5 * 3600, plate_number: "51B-1", driver_name: "TX 1" },
  { schedule_id: 102, route_id: "R1", direction: 1, dep_sec: 10.25 * 3600, plate_number: "51B-2", driver_name: "TX 2" },
  { schedule_id: 103, route_id: "R1", direction: 1, dep_sec: 13 * 3600, plate_number: "51B-3", driver_name: "TX 3" },
  { schedule_id: 104, route_id: "R1", direction: 1, dep_sec: 9 * 3600 + 40 * 60, plate_number: "51B-4", driver_name: "TX 4" },
  { schedule_id: 105, route_id: "R1", direction: 1, dep_sec: 9 * 3600 + 50 * 60, plate_number: "51B-5", driver_name: "TX 5" },
  { schedule_id: 201, route_id: "R2", direction: 1, dep_sec: 10.5 * 3600, plate_number: "51B-6", driver_name: "TX 6" }
];
const PATHS = { "R1|1": { type: "LineString", coordinates: [[106.70, LAT], [106.74, LAT]] } };
const STOPS = {
  "R1|1": [
    { stop_id: "S1", longitude: 106.70, latitude: LAT },
    { stop_id: "S2", longitude: 106.72, latitude: LAT },
    { stop_id: "S3", longitude: 106.74, latitude: LAT }
  ]
};

function makeDb() {
  const calls = { paths: 0 };
  const db = {
    async query(sql, [routeId, direction]) {
      const key = `${routeId}|${direction}`;
      if (sql.includes("FROM route_paths")) {
        calls.paths++;
        return [PATHS[key] ? [{ geom_json: JSON.stringify(PATHS[key]) }] : []];
      }
      if (sql.includes("FROM route_stops")) return [STOPS[key] || []];
      if (sql.includes("FROM schedules")) {
        return [SCHEDULES
          .filter(s => s.route_id === routeId && s.direction === direction)
          .map(s => ({ ...s, departure_time: hms(s.dep_sec) }))];
      }
      throw new Error(`SQL không mong đợi: ${sql}`);
    }
  };
  return { db, calls };
}

function setup() {
  const clock = { t: VN_10H };
  const registry = createTripRegistry({ now: () => clock.t });
  const { db, calls } = makeDb();
  const lister = createTripLister({ db, registry, now: () => clock.t });
  // Chuyến 101 đang chạy, xe ở 106.71 (≈ giữa S1 và S2), trung bình speed_kmh = 30
  registry.start({ schedule_id: 101, vehicle_id: "V1", route_id: "R1", direction: 1 });
  registry.recordPing(101, { longitude: 106.71, latitude: LAT, speed_kmh: 30 });
  return { clock, registry, lister, calls };
}

test("chỉ gồm chuyến công khai; sắp xếp theo ETA; ETA theo vận tốc xe và vận tốc tuyến", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.deepEqual(trips.map(t => [t.schedule_id, t.status]), [[101, "RUNNING"], [105, "UPCOMING"], [102, "UPCOMING"]]);
  // 101: còn ≈ 1093 m ở 30 km/h ≈ 131 s → 2 phút
  assert.equal(trips[0].minutes_to_board, 2);
  // 102: xuất bến 10:15 + ≈ 2187 m ở 30 km/h (trung bình xe đang chạy của tuyến) ≈ 262 s → 19 phút
  assert.equal(trips[2].minutes_to_board, 19);
  assert.equal(trips[2].departure_time, "10:15");
  assert.equal(trips[2].plate_number, "51B-2");
  assert.equal(trips[2].driver_name, "TX 2");
  assert.match(trips[2].eta_board, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(trips.every(t => !("longitude" in t) && !("latitude" in t)));
});

test("chuyến đã qua trạm lên → PASSED, không ETA, xếp cuối", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S1" });
  const last = trips[trips.length - 1];
  assert.equal(last.schedule_id, 101);
  assert.equal(last.status, "PASSED");
  assert.equal(last.eta_board, null);
  assert.equal(last.minutes_to_board, null);
});

test("không có trạm lên → không ETA, theo giờ xuất bến", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: null });
  assert.deepEqual(trips.map(t => t.schedule_id), [101, 105, 102]);
  assert.ok(trips.every(t => t.eta_board === null && t.minutes_to_board === null));
});

test("Review focus: trạm lên không thuộc tuyến/chiều → vẫn trả danh sách, không ETA", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "KHONG_CO" });
  assert.equal(trips.length, 3);
  assert.ok(trips.every(t => t.eta_board === null && t.status !== "PASSED"));
});

test("Review focus: tuyến không có lộ trình → vẫn trả danh sách, không ETA", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R2", direction: 1, board_stop_id: "S2" });
  assert.deepEqual(trips.map(t => [t.schedule_id, t.status, t.eta_board]), [[201, "UPCOMING", null]]);
});

test("hình học được cache theo tuyến/chiều", async () => {
  const { lister, calls } = setup();
  await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S3" });
  assert.equal(calls.paths, 1);
});

test("không chuyến nào trong cửa sổ → [] và không nạp hình học", async () => {
  const { lister, clock, registry, calls } = setup();
  registry.end(101);
  clock.t = Date.UTC(2026, 9, 5, 15, 0, 0);   // 22:00 VN
  assert.deepEqual(await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" }), []);
  assert.equal(calls.paths, 0);
});
