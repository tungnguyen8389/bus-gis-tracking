const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { registerDeviceSocket } = require("./device.socket");
const { createViewerBroadcaster, registerViewerSocket } = require("./viewer.socket");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

const SECRET = "test-secret";
const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const LAT = 10.8;
const VEHICLES = [
  { vehicle_id: "DRV_01", plate_number: "51B-900.01", driver_name: "Tài xế 01", driver_user_id: 1 },
  { vehicle_id: "DRV_02", plate_number: "51B-900.02", driver_name: "Tài xế 02", driver_user_id: 2 }
];
// 11: 05:00 (ngoài cửa sổ nếu chưa chạy); 12: 10:30 (sắp tới); 22: tuyến khác
const SCHEDULES = [
  { schedule_id: 11, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08", dep_sec: 5 * 3600 },
  { schedule_id: 12, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08", dep_sec: 10.5 * 3600 },
  { schedule_id: 22, route_id: "R2", vehicle_id: "DRV_02", direction: 2, route_number: "19", dep_sec: 9.75 * 3600 }
];
const hhmm = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;

const fakeDb = {
  async query(sql, params) {
    if (sql.includes("FROM route_paths")) {
      return [[{ geom_json: JSON.stringify({ type: "LineString", coordinates: [[106.70, LAT], [106.74, LAT]] }) }]];
    }
    if (sql.includes("FROM route_stops")) {
      return [[{ stop_id: "S1", longitude: 106.70, latitude: LAT }, { stop_id: "S2", longitude: 106.72, latitude: LAT }]];
    }
    if (sql.includes("JOIN bus_routes")) return [SCHEDULES.filter(s => s.schedule_id === params[0])];
    if (sql.includes("JOIN vehicles")) {
      return [SCHEDULES
        .filter(s => s.route_id === params[0] && s.direction === params[1])
        .map(s => {
          const v = VEHICLES.find(x => x.vehicle_id === s.vehicle_id);
          return { schedule_id: s.schedule_id, dep_sec: s.dep_sec, departure_time: hhmm(s.dep_sec), plate_number: v.plate_number, driver_name: v.driver_name };
        })];
    }
    if (sql.includes("FROM schedules")) {
      return [SCHEDULES.filter(s => s.schedule_id === params[0]).map(s => ({ schedule_id: s.schedule_id, dep_sec: s.dep_sec }))];
    }
    if (sql.includes("FROM vehicles")) return [VEHICLES.filter(v => v.driver_user_id === params[0])];
    throw new Error(`SQL không mong đợi: ${sql}`);
  }
};

const token = (role, userId = 1) => jwt.sign({ user_id: userId, username: `u${userId}`, role }, SECRET);
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

async function startServer({ tripLister, db = fakeDb, pushIntervalMs = 60_000 } = {}) {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const clock = { t: VN_10H };
  const now = () => clock.t;
  const registry = createTripRegistry({ now });
  const lister = tripLister || createTripLister({ db: fakeDb, registry, now });
  registerDeviceSocket(io, {
    db: fakeDb, jwtSecret: SECRET, registry, now,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: { record: async () => true }
  });
  const hub = registerViewerSocket(io, { db, jwtSecret: SECRET, registry, tripLister: lister, now, pushIntervalMs });
  await new Promise(r => httpServer.listen(0, r));
  const base = `http://localhost:${httpServer.address().port}`;
  const clients = [];
  const connect = async (nsp, auth = {}) => {
    const s = ioClient(`${base}${nsp}`, { auth, reconnection: false, forceNew: true, transports: ["websocket"] });
    clients.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  };
  const close = () => { hub.stop(); clients.forEach(c => c.disconnect()); return new Promise(r => io.close(r)); };
  return { connect, clock, registry, io, close };
}

const collect = (socket, event) => {
  const got = [];
  socket.on(event, d => got.push(d));
  return got;
};
const ack = (s, event, payload) => s.timeout(2000).emitWithAck(event, payload);
async function startDriver(srv, userId, scheduleId) {
  const dev = await srv.connect("/device", { token: token("DRIVER", userId) });
  const res = await ack(dev, "trip:start", { schedule_id: scheduleId });
  assert.equal(res.ok, true);
  return dev;
}
async function ping(srv, dev, lon = 106.71) {
  srv.clock.t += 1000;
  dev.emit("gps_ping", { latitude: LAT, longitude: lon, speed_kmh: 30, heading: 90 });
  await tick();
}

test("khách chưa watch → không nhận vị trí xe nào", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  const got = collect(guest, "fleet_location_update");
  const dev = await startDriver(srv, 1, 11);
  await ping(srv, dev);
  assert.equal(got.length, 0);
});

test("trip:watch chuyến ngoài cửa sổ → TRIP_NOT_AVAILABLE; đang chạy → nhận đúng xe đó", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 11 }), { ok: false, error: "TRIP_NOT_AVAILABLE" });

  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 11 }), { ok: true, status: "RUNNING" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(got.map(p => [p.vehicle_id, p.schedule_id]), [["DRV_01", 11]]);
});

test("watch chuyến khác → rời room cũ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  await ack(guest, "trip:watch", { schedule_id: 11 });
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 12 }), { ok: true, status: "UPCOMING" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  assert.equal(got.length, 0);
});

test("trip:unwatch → không nhận nữa", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  await ack(guest, "trip:watch", { schedule_id: 11 });
  guest.emit("trip:unwatch");
  await tick();
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  assert.equal(got.length, 0);
});

test("nhân viên nhận mọi xe; token sai/hết hạn bị coi là khách", async t => {
  const srv = await startServer(); t.after(srv.close);
  const staff = await srv.connect("", { token: token("MANAGER") });
  const expired = jwt.sign({ user_id: 1, role: "ADMIN" }, SECRET, { expiresIn: -10 });
  const fake = await srv.connect("", { token: expired });
  const gotStaff = collect(staff, "fleet_location_update");
  const gotFake = collect(fake, "fleet_location_update");
  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(gotStaff.map(p => p.vehicle_id).sort(), ["DRV_01", "DRV_02"]);
  assert.equal(gotFake.length, 0);
});

test("tài xế trên '/' nhận xe của mình bất kể chuyến, không nhận xe khác", async t => {
  const srv = await startServer(); t.after(srv.close);
  const driverViewer = await srv.connect("", { token: token("DRIVER", 1) });
  const got = collect(driverViewer, "fleet_location_update");
  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(got.map(p => p.vehicle_id), ["DRV_01"]);
});

test("vehicle_offline chỉ tới room chuyến đó và staff", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const watcher = await srv.connect("");
  const other = await srv.connect("");
  await ack(watcher, "trip:watch", { schedule_id: 11 });
  await ack(other, "trip:watch", { schedule_id: 12 });
  const gotWatcher = collect(watcher, "vehicle_offline");
  const gotOther = collect(other, "vehicle_offline");
  await ack(dev1, "trip:end", {});
  await tick();
  assert.deepEqual(gotWatcher, [{ vehicle_id: "DRV_01", schedule_id: 11 }]);
  assert.equal(gotOther.length, 0);
});

test("trips:subscribe ack danh sách; trips:update đẩy ngay khi chuyến bắt đầu; không có tọa độ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  const res = await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.trips.map(x => [x.schedule_id, x.status]), [[12, "UPCOMING"]]);

  const updates = collect(guest, "trips:update");
  await startDriver(srv, 1, 11);
  await tick();
  assert.ok(updates.length >= 1);
  const last = updates[updates.length - 1];
  assert.equal(last.route_id, "R1");
  assert.equal(last.direction, 1);
  assert.deepEqual(last.trips.map(x => [x.schedule_id, x.status]), [[11, "RUNNING"], [12, "UPCOMING"]]);
  assert.doesNotMatch(JSON.stringify(updates), /longitude|latitude/);
});

test("trips:unsubscribe → không nhận trips:update nữa", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1 });
  guest.emit("trips:unsubscribe");
  await tick();
  const updates = collect(guest, "trips:update");
  await startDriver(srv, 1, 11);
  await tick();
  assert.equal(updates.length, 0);
});

test("Review focus: payload rác → lỗi có mã, socket vẫn sống", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trip:watch", "abc"), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: -1 }), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trip:watch", {}), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trips:subscribe", { route_id: "R1", direction: 3 }), { ok: false, error: "BAD_REQUEST" });
  assert.deepEqual(await ack(guest, "trips:subscribe", null), { ok: false, error: "BAD_REQUEST" });
  guest.emit("trip:watch", { schedule_id: 12 });            // không có ack
  guest.emit("trips:subscribe", { route_id: "R1", direction: 1 });
  await tick();
  assert.equal(guest.connected, true);
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 12 }), { ok: true, status: "UPCOMING" });
});

test("Review focus: lister lỗi → subscribe trả SERVER_ERROR, đẩy theo sự kiện không làm sập server", async t => {
  const failing = { list: async () => { throw new Error("DB down"); } };
  const srv = await startServer({ tripLister: failing }); t.after(srv.close);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1 }), { ok: false, error: "SERVER_ERROR" });
  await startDriver(srv, 1, 11);   // registry change → đẩy → lister ném lỗi
  await tick();
  assert.equal(guest.connected, true);
});

// db giả giữ câu SELECT của trip:watch (theo schedule_id) cho tới khi release()
function gatedDb() {
  const gates = new Map();
  return {
    gate(scheduleId) {
      let release;
      gates.set(scheduleId, new Promise(r => { release = r; }));
      return () => { gates.delete(scheduleId); release(); };
    },
    async query(sql, params) {
      if (!sql.includes("JOIN") && sql.includes("FROM schedules")) {
        const g = gates.get(params[0]);
        if (g) await g;
      }
      return fakeDb.query(sql, params);
    }
  };
}

test("trip:watch đang chờ DB rồi trip:unwatch → không vào room chuyến", async t => {
  const db = gatedDb();
  const srv = await startServer({ db }); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  const release = db.gate(11);
  const pending = ack(guest, "trip:watch", { schedule_id: 11 });
  await tick();
  guest.emit("trip:unwatch");
  await tick();
  release();
  assert.deepEqual(await pending, { ok: false, error: "TRIP_NOT_AVAILABLE" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  assert.equal(got.length, 0);
});

test("trip:watch A đang chờ rồi watch B → chỉ nhận B", async t => {
  const db = gatedDb();
  const srv = await startServer({ db }); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  const guest = await srv.connect("");
  const release = db.gate(11);
  const pendingA = ack(guest, "trip:watch", { schedule_id: 11 });
  await tick();
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 22 }), { ok: true, status: "RUNNING" });
  release();
  assert.deepEqual(await pendingA, { ok: false, error: "TRIP_NOT_AVAILABLE" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(got.map(p => [p.vehicle_id, p.schedule_id]), [["DRV_02", 22]]);
});

// Chặn chính là socket.io (socket đã ngắt có join = noop); test này giữ hành vi, không đo riêng guard connected
test("trip:watch đang chờ, khách ngắt kết nối → không để lại room ma", async t => {
  const db = gatedDb();
  const srv = await startServer({ db }); t.after(srv.close);
  await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  const release = db.gate(11);
  guest.emit("trip:watch", { schedule_id: 11 });
  await tick();
  guest.disconnect();
  await tick();
  release();
  await tick();
  assert.equal(srv.io.of("/").adapter.rooms.get("trip:11"), undefined);
});

test("đẩy định kỳ: không có thay đổi registry vẫn nhận trips:update", async t => {
  const srv = await startServer({ pushIntervalMs: 50 }); t.after(srv.close);
  const guest = await srv.connect("");
  assert.equal((await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1 })).ok, true);
  const updates = collect(guest, "trips:update");
  await tick(250);
  assert.ok(updates.length >= 1);
  assert.equal(updates[0].route_id, "R1");
});
