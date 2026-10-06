const { io } = require("socket.io-client");
const { processRouteGeometry, getInterpolatedPosition } = require("./route-geometry");
const { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule } = require("./schedule");

const TICK_MS = 500;
const RETRY_MS = 5000;

// --------------------------------------------------------------------
// MỘT TÀI XẾ ẢO: đăng nhập như tài xế thật → nhận lịch trình → phát GPS qua /device.
// Chỉ dùng API public; không đọc CSDL, không import code backend.
// --------------------------------------------------------------------
class VirtualDriver {
  constructor({ apiUrl, username, password, log = msg => console.log(`>>> [Simulator] ${msg}`), now = Date.now }) {
    Object.assign(this, { apiUrl, username, password, log, now });
    this.stopped = false;
    this.socket = null;
    this.timer = null;
    this.trip = null;
    this.relogged = false;
    this.switching = false;
    this.nextSwitchAttemptAt = 0;
  }

  async start() {
    if (this.stopped) return;
    try {
      await this.login();
      const me = await this.api("/driver/me");
      this.plate = me.vehicle.plate_number;
      this.schedules = me.schedules;
      this.schedule = pickSchedule(this.schedules, vnMinutesOfDay(this.now()));
      if (!this.schedule) return this.fail("xe chưa có lịch trình");

      this.route = await this.fetchRoute(this.schedule);
      if (!this.route) return this.fail("lộ trình không hợp lệ");

      // Xuất phát ở vị trí ngẫu nhiên để các xe không chồng lên nhau
      this.distance = Math.random() * this.route.totalDist;
      this.baseSpeed = 30 + Math.random() * 10;
      this.connect();
    } catch (err) {
      if (err.fatal) return this.fail(err.message);
      if (this.stopped) return;
      this.log(`${this.username}: ${err.message} → thử lại sau ${RETRY_MS / 1000}s`);
      setTimeout(() => this.start(), RETRY_MS);
    }
  }

  async login() {
    const { token } = await this.fetchJson("/auth/driver/login", {
      method: "POST",
      body: { username: this.username, password: this.password }
    });
    this.token = token;
  }

  api(path) {
    return this.fetchJson(path, { token: this.token });
  }

  async fetchRoute({ route_id, direction }) {
    const path = await this.api(`/routes/${encodeURIComponent(route_id)}/path?direction=${direction}`);
    const coords = path.geometry.type === "MultiLineString" ? path.geometry.coordinates.flat() : path.geometry.coordinates;
    return processRouteGeometry(coords);
  }

  // Tới giờ xuất bến chuyến kế tiếp → chạy từ đầu lộ trình chiều mới; server tự kết thúc chuyến cũ
  async switchTrip(next) {
    this.switching = true;
    try {
      const route = await this.fetchRoute(next);
      if (this.stopped) return;
      if (!route) {
        this.nextSwitchAttemptAt = this.now() + RETRY_MS;
        return this.log(`${this.username}: lộ trình chuyến ${next.departure_time} không hợp lệ → thử lại sau`);
      }
      Object.assign(this, { schedule: next, route, distance: 0, trip: null });
      this.log(`${this.username}: tới giờ chuyến ${next.departure_time} → đổi chuyến`);
      await this.beginTrip();
    } catch (err) {
      this.nextSwitchAttemptAt = this.now() + RETRY_MS;
      this.log(`${this.username}: không nạp được lộ trình chuyến mới (${err.message}) → thử lại sau ${RETRY_MS / 1000}s`);
    } finally {
      this.switching = false;
    }
  }

  // Lỗi 4xx đánh dấu fatal (sai tài khoản / chưa gán xe) → bỏ tài xế; lỗi mạng / 5xx → thử lại
  async fetchJson(path, { method = "GET", body, token } = {}) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${this.apiUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      throw new Error(`không kết nối được ${this.apiUrl} (${err.cause?.code || err.message})`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(`${method} ${path} → ${res.status} ${data?.error || ""}`.trim());
      error.fatal = res.status >= 400 && res.status < 500;
      throw error;
    }
    return data;
  }

  connect() {
    this.socket = io(`${this.apiUrl}/device`, { auth: { token: this.token }, reconnectionDelay: 2000 });
    // Mỗi lần (re)connect là socket mới trên server → phải gửi lại trip:start
    this.socket.on("connect", () => this.beginTrip());
    this.socket.on("disconnect", () => { this.trip = null; clearTimeout(this.retryTimer); });
    this.socket.on("connect_error", err => this.onConnectError(err));
    this.socket.on("session:replaced", () => {
      this.log(`${this.username}: bị thay bởi thiết bị khác → dừng xe ${this.plate}`);
      this.stop(false);
    });
  }

  async beginTrip() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    try {
      const ack = await this.socket.timeout(5000).emitWithAck("trip:start", { schedule_id: this.schedule.schedule_id });
      if (this.stopped) return;
      if (!ack.ok) {
        // SERVER_ERROR là lỗi tạm thời (DB / backend khởi động lại) → thử lại; mã khác (SCHEDULE_NOT_ALLOWED) là vĩnh viễn
        if (ack.error !== "SERVER_ERROR") return this.fail(`trip:start bị từ chối (${ack.error})`);
        this.log(`${this.username}: trip:start lỗi tạm thời (${ack.error}) → thử lại sau ${RETRY_MS / 1000}s`);
        return this.retryTrip();
      }
      this.trip = ack.trip;
      this.relogged = false;
      this.log(`${this.username}: xe ${this.plate} chạy Tuyến ${ack.trip.route_number} chiều ${ack.trip.direction}`);
      if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    } catch (err) {
      if (this.stopped) return;
      this.log(`${this.username}: trip:start không phản hồi (${err.message}) → thử lại sau ${RETRY_MS / 1000}s`);
      this.retryTrip();
    }
  }

  // Hẹn gửi lại trip:start; nếu socket đã rớt thì bỏ qua (lần connect sau tự gọi beginTrip)
  retryTrip() {
    this.retryTimer = setTimeout(() => {
      if (!this.stopped && this.socket?.connected) this.beginTrip();
    }, RETRY_MS);
  }

  async onConnectError(err) {
    if (this.stopped) return;
    // Lỗi tầng mạng: socket.io tự kết nối lại (socket.active = true)
    if (this.socket.active) return this.log(`${this.username}: mất kết nối socket (${err.message}), đang thử lại`);
    if (err.message === "SERVER_ERROR") {
      // Lỗi tạm thời phía server → kết nối lại sau RETRY_MS
      this.log(`${this.username}: server lỗi tạm thời (${err.message}) → thử lại sau ${RETRY_MS / 1000}s`);
      this.retryTimer = setTimeout(() => { if (!this.stopped) this.socket.connect(); }, RETRY_MS);
      return;
    }
    if (err.message !== "UNAUTHORIZED") return this.fail(`socket bị từ chối (${err.message})`);
    if (this.relogged) return this.fail("token vẫn bị từ chối sau khi đăng nhập lại");

    // Token hết hạn → đăng nhập lại một lần
    this.relogged = true;
    try {
      await this.login();
      this.socket.auth.token = this.token;
      this.socket.connect();
    } catch (e) {
      this.fail(e.message);
    }
  }

  tick() {
    if (!this.trip || !this.socket?.connected || this.switching) return;
    const next = this.schedules ? nextSchedule(this.schedules, this.schedule) : null;
    const nowMs = this.now();
    if (next && toMinutes(next.departure_time) <= vnMinutesOfDay(nowMs) && nowMs >= this.nextSwitchAttemptAt) {
      this.switchTrip(next);
      return;
    }
    const speed = Math.max(15, this.baseSpeed + Math.sin(Date.now() / 5000) * 3);
    this.distance = (this.distance + (speed / 3.6) * (TICK_MS / 1000)) % this.route.totalDist;
    const pos = getInterpolatedPosition(this.route, this.distance);
    this.socket.emit("gps_ping", {
      latitude: Number(pos.latitude.toFixed(6)),
      longitude: Number(pos.longitude.toFixed(6)),
      speed_kmh: Math.round(speed),
      heading: pos.heading
    });
  }

  // endTrip: báo trip:end để bản đồ gỡ xe ngay (khi Ctrl+C); false khi đã bị thay / bị từ chối
  stop(endTrip = true) {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = null;
    const socket = this.socket;
    if (!socket) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { socket.disconnect(); resolve(); };
      if (endTrip && this.trip && socket.connected) socket.timeout(1000).emit("trip:end", {}, done);
      else done();
    });
  }

  fail(reason) {
    this.log(`${this.username}: ${reason} → bỏ tài xế này`);
    this.stop(false);
  }
}

module.exports = { VirtualDriver };
