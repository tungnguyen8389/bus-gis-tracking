const test = require("node:test");
const assert = require("node:assert/strict");
const { VirtualDriver } = require("./virtual-driver");

const RETRY_MS = 5000;
const OK_ACK = { ok: true, trip: { route_number: "01", direction: 1 } };
const flush = () => new Promise(resolve => setImmediate(resolve));

// Socket giả: mỗi lần emitWithAck lấy một kết quả trong kịch bản (Error thì ném lỗi như timeout)
function makeDriver(script, { now } = {}) {
  const driver = new VirtualDriver({ apiUrl: "http://x", username: "driver01", password: "p", log: () => {}, now });
  driver.schedule = { schedule_id: 1 };
  driver.plate = "X";
  const calls = { emitWithAck: 0, connect: 0, acks: [], emits: [] };
  driver.socket = {
    connected: true,
    active: false,
    auth: {},
    timeout: () => ({
      emitWithAck: async (...args) => {
        calls.acks.push(args);
        const step = script[Math.min(calls.emitWithAck++, script.length - 1)];
        if (step instanceof Error) throw step;
        return step;
      }
    }),
    emit: (...args) => calls.emits.push(args),
    connect: () => { calls.connect++; },
    disconnect: () => {}
  };
  return { driver, calls };
}

const mockTimers = t => t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

test("ack SERVER_ERROR → thử lại sau RETRY_MS rồi vào chuyến", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([{ ok: false, error: "SERVER_ERROR" }, OK_ACK]);
  await driver.beginTrip();
  assert.equal(driver.trip, null);
  assert.equal(driver.stopped, false);
  t.mock.timers.tick(RETRY_MS);
  await flush();
  assert.equal(calls.emitWithAck, 2);
  assert.deepEqual(driver.trip, OK_ACK.trip);
  assert.equal(driver.stopped, false);
  await driver.stop(false);
});

test("trip:start hết thời gian chờ → thử lại sau RETRY_MS", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([new Error("operation has timed out"), OK_ACK]);
  await driver.beginTrip();
  assert.equal(driver.trip, null);
  t.mock.timers.tick(RETRY_MS);
  await flush();
  assert.equal(calls.emitWithAck, 2);
  assert.deepEqual(driver.trip, OK_ACK.trip);
  await driver.stop(false);
});

test("ack SCHEDULE_NOT_ALLOWED → dừng hẳn, không thử lại", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([{ ok: false, error: "SCHEDULE_NOT_ALLOWED" }, OK_ACK]);
  await driver.beginTrip();
  assert.equal(driver.stopped, true);
  t.mock.timers.tick(RETRY_MS * 2);
  await flush();
  assert.equal(calls.emitWithAck, 1);
  assert.equal(driver.trip, null);
});

test("stop(false) khi đang chờ thử lại → không gọi emitWithAck nữa", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([{ ok: false, error: "SERVER_ERROR" }, OK_ACK]);
  await driver.beginTrip();
  await driver.stop(false);
  t.mock.timers.tick(RETRY_MS * 2);
  await flush();
  assert.equal(calls.emitWithAck, 1);
  assert.equal(driver.trip, null);
});

test("socket đã mất kết nối khi đến hẹn → không thử lại (connect mới tự chạy beginTrip)", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([new Error("operation has timed out"), OK_ACK]);
  await driver.beginTrip();
  driver.socket.connected = false;
  t.mock.timers.tick(RETRY_MS);
  await flush();
  assert.equal(calls.emitWithAck, 1);
  await driver.stop(false);
});

test("connect_error SERVER_ERROR → connect lại sau RETRY_MS, không bỏ tài xế", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([OK_ACK]);
  await driver.onConnectError(new Error("SERVER_ERROR"));
  assert.equal(driver.stopped, false);
  assert.equal(calls.connect, 0);
  t.mock.timers.tick(RETRY_MS);
  assert.equal(calls.connect, 1);
  await driver.stop(false);
});

test("connect_error SERVER_ERROR rồi stop → không connect lại", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([OK_ACK]);
  await driver.onConnectError(new Error("SERVER_ERROR"));
  await driver.stop(false);
  t.mock.timers.tick(RETRY_MS * 2);
  assert.equal(calls.connect, 0);
});

test("connect_error NO_VEHICLE → dừng hẳn", async t => {
  mockTimers(t);
  const { driver, calls } = makeDriver([OK_ACK]);
  await driver.onConnectError(new Error("NO_VEHICLE"));
  assert.equal(driver.stopped, true);
  t.mock.timers.tick(RETRY_MS * 2);
  assert.equal(calls.connect, 0);
});

test("tới giờ xuất bến chuyến kế tiếp → nạp lộ trình chiều mới, distance = 0, trip:start chuyến mới", async t => {
  mockTimers(t);
  const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);
  const { driver, calls } = makeDriver([OK_ACK], { now: () => VN_10H });
  const first = { schedule_id: 1, route_id: "R", direction: 1, departure_time: "09:00" };
  const second = { schedule_id: 2, route_id: "R", direction: 2, departure_time: "10:00" };
  driver.schedules = [first, second];
  driver.schedule = first;
  driver.trip = { route_number: "01", direction: 1 };
  driver.route = { totalDist: 1000 };
  driver.distance = 500;
  const paths = [];
  driver.api = async path => {
    paths.push(path);
    return { geometry: { type: "LineString", coordinates: [[106.70, 10.8], [106.71, 10.8]] } };
  };

  driver.tick();
  await flush();
  await flush();

  assert.deepEqual(paths, ["/routes/R/path?direction=2"]);
  assert.equal(driver.schedule, second);
  assert.equal(driver.distance, 0);
  assert.deepEqual(calls.acks[0], ["trip:start", { schedule_id: 2 }]);
  assert.equal(calls.emits.length, 0);   // tick đổi chuyến không phát gps_ping
  await driver.stop(false);
});

test("chưa tới giờ chuyến kế tiếp → tick phát gps_ping như thường", async t => {
  mockTimers(t);
  const VN_0930 = Date.UTC(2026, 9, 5, 2, 30, 0);
  const { driver, calls } = makeDriver([OK_ACK], { now: () => VN_0930 });
  driver.schedules = [
    { schedule_id: 1, route_id: "R", direction: 1, departure_time: "09:00" },
    { schedule_id: 2, route_id: "R", direction: 2, departure_time: "10:00" }
  ];
  driver.schedule = driver.schedules[0];
  driver.trip = { route_number: "01", direction: 1 };
  const { processRouteGeometry } = require("./route-geometry");
  driver.route = processRouteGeometry([[106.70, 10.8], [106.71, 10.8]]);
  driver.distance = 0;
  driver.baseSpeed = 30;
  driver.tick();
  assert.equal(calls.emits.length, 1);
  assert.equal(calls.emits[0][0], "gps_ping");
  await driver.stop(false);
});

test("đổi chuyến gặp 401 (token hết hạn) → đăng nhập lại, cập nhật socket.auth, lượt sau đổi chuyến thành công", async t => {
  mockTimers(t);
  let nowMs = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 VN
  const { driver, calls } = makeDriver([OK_ACK], { now: () => nowMs });
  const first = { schedule_id: 1, route_id: "R", direction: 1, departure_time: "09:00" };
  const second = { schedule_id: 2, route_id: "R", direction: 2, departure_time: "10:00" };
  driver.schedules = [first, second];
  driver.schedule = first;
  driver.trip = { route_number: "01", direction: 1 };
  driver.route = require("./route-geometry").processRouteGeometry([[106.70, 10.8], [106.71, 10.8]]);
  driver.distance = 0;
  driver.baseSpeed = 30;
  let logins = 0;
  driver.login = async () => { logins++; driver.token = "fresh"; };
  let apiCalls = 0;
  driver.api = async () => {
    if (apiCalls++ === 0) throw Object.assign(new Error("GET /routes → 401"), { status: 401, fatal: true });
    return { geometry: { type: "LineString", coordinates: [[106.70, 10.8], [106.71, 10.8]] } };
  };

  driver.tick();
  await flush();
  await flush();
  assert.equal(logins, 1);
  assert.equal(driver.socket.auth.token, "fresh");
  assert.equal(driver.schedule, first);
  assert.equal(driver.stopped, false);

  driver.tick();                               // chưa hết RETRY_MS → không nạp lại lộ trình, vẫn chạy chuyến cũ
  await flush();
  assert.equal(apiCalls, 1);
  assert.equal(driver.schedule, first);
  calls.emits.length = 0;

  nowMs += RETRY_MS;
  driver.tick();
  await flush();
  await flush();
  assert.equal(driver.schedule, second);
  assert.deepEqual(calls.acks[0], ["trip:start", { schedule_id: 2 }]);
  assert.equal(logins, 1);
  await driver.stop(false);
});

