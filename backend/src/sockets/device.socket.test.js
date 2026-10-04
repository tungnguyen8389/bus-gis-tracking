const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { registerDeviceSocket } = require("./device.socket");

const SECRET = "test-secret";
const VEHICLES = [
  { vehicle_id: "DRV_01", plate_number: "51B-900.01", driver_user_id: 1 },
  { vehicle_id: "DRV_02", plate_number: "51B-900.02", driver_user_id: 2 }
];
const SCHEDULES = [
  { schedule_id: 11, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08" },
  { schedule_id: 22, route_id: "R2", vehicle_id: "DRV_02", direction: 2, route_number: "19" }
];

// DB giả: chỉ trả lời 2 truy vấn mà handshake và trip:start dùng
const fakeDb = {
  async query(sql, params) {
    if (sql.includes("FROM vehicles")) return [VEHICLES.filter(v => v.driver_user_id === params[0])];
    if (sql.includes("FROM schedules")) return [SCHEDULES.filter(s => s.schedule_id === params[0])];
    throw new Error(`SQL không mong đợi: ${sql}`);
  }
};

const driverToken = userId => jwt.sign({ user_id: userId, username: `driver0${userId}`, role: "DRIVER" }, SECRET);
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

async function startServer() {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const clock = { t: 1_000_000 };
  const published = { locations: [], offline: [] };
  const broadcaster = {
    publishLocation: p => published.locations.push(p),
    publishOffline: id => published.offline.push(id)
  };
  registerDeviceSocket(io, {
    db: fakeDb, jwtSecret: SECRET, broadcaster,
    trackingLog: { record: async () => true },
    now: () => clock.t
  });
  await new Promise(r => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}/device`;
  const clients = [];
  const connect = token => {
    const s = ioClient(url, { auth: token ? { token } : {}, reconnection: false, forceNew: true, transports: ["websocket"] });
    clients.push(s);
    return s;
  };
  const close = () => { clients.forEach(c => c.disconnect()); return new Promise(r => io.close(r)); };
  return { connect, published, clock, close };
}

const waitConnect = s => new Promise((resolve, reject) => {
  s.once("connect", resolve);
  s.once("connect_error", reject);
});
const startTrip = (s, scheduleId) => s.timeout(2000).emitWithAck("trip:start", { schedule_id: scheduleId });

test("không có token → UNAUTHORIZED", async t => {
  const srv = await startServer(); t.after(srv.close);
  await assert.rejects(waitConnect(srv.connect()), { message: "UNAUTHORIZED" });
});

test("token không phải DRIVER → UNAUTHORIZED", async t => {
  const srv = await startServer(); t.after(srv.close);
  const adminToken = jwt.sign({ user_id: 1, role: "ADMIN" }, SECRET);
  await assert.rejects(waitConnect(srv.connect(adminToken)), { message: "UNAUTHORIZED" });
});

test("tài xế chưa gán xe → NO_VEHICLE", async t => {
  const srv = await startServer(); t.after(srv.close);
  await assert.rejects(waitConnect(srv.connect(driverToken(99))), { message: "NO_VEHICLE" });
});

test("trip:start với lịch trình của xe khác → SCHEDULE_NOT_ALLOWED", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  assert.deepEqual(await startTrip(s, 22), { ok: false, error: "SCHEDULE_NOT_ALLOWED" });
});

test("ping trước trip:start bị bỏ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  s.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations.length, 0);
});

test("ping hợp lệ → server dựng gói theo xe đã xác thực, bỏ vehicle_id client gửi", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  const ack = await startTrip(s, 11);
  assert.deepEqual(ack, { ok: true, trip: { schedule_id: 11, route_id: "R1", route_number: "08", direction: 1 } });
  s.emit("gps_ping", { vehicle_id: "DRV_02", latitude: 10.8, longitude: 106.7, speed_kmh: 30, heading: 45 });
  await tick();
  assert.equal(srv.published.locations.length, 1);
  const p = srv.published.locations[0];
  assert.equal(p.vehicle_id, "DRV_01");
  assert.equal(p.plate_number, "51B-900.01");
  assert.equal(p.route_id, "R1");
  assert.equal(p.route_number, "08");
  assert.equal(p.direction, 1);
  assert.equal(p.latitude, 10.8);
  assert.equal(p.longitude, 106.7);
  assert.equal(p.speed_kmh, 30);
  assert.equal(p.heading, 45);
  assert.equal(p.timestamp, new Date(srv.clock.t).toISOString());
});

test("ping sai định dạng bị bỏ; ping cách nhau < 250ms bị bỏ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  s.emit("gps_ping", { latitude: 999, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations.length, 0);

  s.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  srv.clock.t += 249;
  s.emit("gps_ping", { latitude: 10.81, longitude: 106.7 });
  await tick();
  srv.clock.t += 1;
  s.emit("gps_ping", { latitude: 10.82, longitude: 106.7 });
  await tick();
  assert.deepEqual(srv.published.locations.map(p => p.latitude), [10.8, 10.82]);
});

test("phiên thứ hai cùng xe → phiên cũ nhận session:replaced, KHÔNG phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const first = srv.connect(driverToken(1)); await waitConnect(first);
  await startTrip(first, 11);
  const replaced = new Promise(r => first.once("session:replaced", r));
  const second = srv.connect(driverToken(1)); await waitConnect(second);
  await replaced;
  await tick();
  assert.equal(first.connected, false);
  assert.deepEqual(srv.published.offline, []);
});

test("trip:end → phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  assert.deepEqual(await s.timeout(2000).emitWithAck("trip:end", {}), { ok: true });
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});

test("ngắt kết nối khi đang có trip → phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  s.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});

test("phiên mới thay phiên cũ rồi ngắt khi chưa trip:start → vẫn gỡ xe khỏi bản đồ đúng 1 lần", async t => {
  const srv = await startServer(); t.after(srv.close);
  const a = srv.connect(driverToken(1)); await waitConnect(a);
  await startTrip(a, 11);
  a.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations.length, 1);

  const replaced = new Promise(r => a.once("session:replaced", r));
  const b = srv.connect(driverToken(1)); await waitConnect(b);
  await replaced;
  await tick();
  assert.deepEqual(srv.published.offline, []);

  b.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});

test("phiên thay thế gọi trip:end khi chưa trip:start → gỡ xe khỏi bản đồ, ngắt sau đó không phát lại", async t => {
  const srv = await startServer(); t.after(srv.close);
  const a = srv.connect(driverToken(1)); await waitConnect(a);
  await startTrip(a, 11);
  a.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  const b = srv.connect(driverToken(1)); await waitConnect(b);
  await tick();
  assert.deepEqual(await b.timeout(2000).emitWithAck("trip:end", {}), { ok: true });
  b.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});

test("kết nối rồi ngắt mà chưa từng phát vị trí → không phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  s.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, []);
});
