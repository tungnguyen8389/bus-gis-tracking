const test = require("node:test");
const assert = require("node:assert/strict");
const { VirtualDriver } = require("./virtual-driver");

const RETRY_MS = 5000;
const OK_ACK = { ok: true, trip: { route_number: "01", direction: 1 } };
const flush = () => new Promise(resolve => setImmediate(resolve));

// Socket giả: mỗi lần emitWithAck lấy một kết quả trong kịch bản (Error thì ném lỗi như timeout)
function makeDriver(script) {
  const driver = new VirtualDriver({ apiUrl: "http://x", username: "driver01", password: "p", log: () => {} });
  driver.schedule = { schedule_id: 1 };
  driver.plate = "X";
  const calls = { emitWithAck: 0, connect: 0 };
  driver.socket = {
    connected: true,
    active: false,
    auth: {},
    timeout: () => ({
      emitWithAck: async () => {
        const step = script[Math.min(calls.emitWithAck++, script.length - 1)];
        if (step instanceof Error) throw step;
        return step;
      }
    }),
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
