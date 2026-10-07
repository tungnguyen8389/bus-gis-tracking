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
  { schedule_id: 201, route_id: "R2", direction: 1, dep_sec: 10.5 * 3600, plate_number: "51B-6", driver_name: "TX 6" },
  { schedule_id: 301, route_id: "R1", direction: 2, dep_sec: 9.5 * 3600, plate_number: "51B-7", driver_name: "TX 7" }
];
const PATHS = { "R1|1": { type: "LineString", coordinates: [[106.70, LAT], [106.74, LAT]] } };
const STOPS = {
  "R1|1": [
    { stop_id: "S1", longitude: 106.70, latitude: LAT },
    { stop_id: "S2", longitude: 106.72, latitude: LAT },
    { stop_id: "S3", longitude: 106.74, latitude: LAT }
  ]
};

function makeDb(opts = {}) {
  const calls = { paths: 0 };
  const db = {
    async query(sql, [routeId, direction]) {
      const key = `${routeId}|${direction}`;
      if (sql.includes("FROM route_paths")) {
        calls.paths++;
        // Xử lý lỗi đầu tiên nếu throwPathsError được set
        if (opts.throwPathsError && calls.paths === 1) {
          throw new Error("DB connection error");
        }
        // Xử lý lỗi cho direction cụ thể nếu throwPathsForKey được set
        if (opts.throwPathsForKey === key) {
          throw new Error("DB connection error");
        }
        // Lấy path từ PATHS hoặc override nếu có
        const paths = opts.paths || PATHS;
        return [paths[key] ? [{ geom_json: JSON.stringify(paths[key]) }] : []];
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

test("lỗi nạp hình học xóa cache, lần sau retry thành công", async () => {
  const clock = { t: VN_10H };
  const registry = createTripRegistry({ now: () => clock.t });
  const { db, calls } = makeDb({ throwPathsError: true });
  const lister = createTripLister({ db, registry, now: () => clock.t });

  // Lần đầu: lỗi
  await assert.rejects(lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" }));

  // Lần hai: throwPathsError giả bị tắt (calls.paths = 2), thành công
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.equal(calls.paths, 2);
  assert.ok(trips.length > 0);
  assert.ok(trips.some(t => t.eta_board !== null)); // Có ETA vì hình học được nạp thành công
});

test("xe đang chạy chiều khác lỗi nạp hình học không làm fail list", async () => {
  const clock = { t: VN_10H };
  const registry = createTripRegistry({ now: () => clock.t });
  const { db, calls } = makeDb({ throwPathsForKey: "R1|2" });
  const lister = createTripLister({ db, registry, now: () => clock.t });

  // Xe chiều 2 (direction = 2) đang chạy nhưng hình học nạp lỗi
  registry.start({ schedule_id: 301, vehicle_id: "V2", route_id: "R1", direction: 2 });
  registry.recordPing(301, { longitude: 106.71, latitude: LAT, speed_kmh: 30 });

  // Xe chiều 1 đang chạy
  registry.start({ schedule_id: 101, vehicle_id: "V1", route_id: "R1", direction: 1 });
  registry.recordPing(101, { longitude: 106.71, latitude: LAT, speed_kmh: 30 });

  // List chiều 1 vẫn thành công (lỗi R1|2 không làm fail)
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.ok(trips.length > 0);
  assert.ok(trips.some(t => t.status === "RUNNING")); // Chuyến 101 vẫn có
});

test("tuyến không có lộ trình được re-query lần sau", async () => {
  const clock = { t: VN_10H };
  const registry = createTripRegistry({ now: () => clock.t });
  const paths = {}; // Mutable fixture, bắt đầu trống
  const { db, calls } = makeDb({ paths });
  const lister = createTripLister({ db, registry, now: () => clock.t });

  // Lần đầu: R1|1 không có lộ trình
  let trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.equal(calls.paths, 1);
  assert.ok(trips.every(t => t.eta_board === null)); // Không ETA vì không có hình học

  // Thêm lộ trình vào fixture
  paths["R1|1"] = PATHS["R1|1"];

  // Lần hai: cache bị xóa (null), re-query và nạp hình học thành công
  trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.equal(calls.paths, 2);
  assert.ok(trips.some(t => t.eta_board !== null)); // Có ETA vì hình học được nạp
});
