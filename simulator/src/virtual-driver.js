const { io } = require("socket.io-client");
const { processRouteGeometry, getInterpolatedPosition } = require("./route-geometry");

const TICK_MS = 500;
const RETRY_MS = 5000;

// --------------------------------------------------------------------
// MỘT TÀI XẾ ẢO: đăng nhập như tài xế thật → nhận lịch trình → phát GPS qua /device.
// Chỉ dùng API public; không đọc CSDL, không import code backend.
// --------------------------------------------------------------------
class VirtualDriver {
  constructor({ apiUrl, username, password, log = msg => console.log(`>>> [Simulator] ${msg}`) }) {
    Object.assign(this, { apiUrl, username, password, log });
    this.stopped = false;
    this.socket = null;
    this.timer = null;
    this.trip = null;
    this.relogged = false;
  }

  async start() {
    if (this.stopped) return;
    try {
      await this.login();
      const me = await this.api("/driver/me");
      this.plate = me.vehicle.plate_number;
      this.schedule = me.schedules[0];
      if (!this.schedule) return this.fail("xe chưa có lịch trình");

      const { route_id, direction } = this.schedule;
      const path = await this.api(`/routes/${encodeURIComponent(route_id)}/path?direction=${direction}`);
      const coords = path.geometry.type === "MultiLineString" ? path.geometry.coordinates.flat() : path.geometry.coordinates;
      this.route = processRouteGeometry(coords);
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
    this.socket.on("disconnect", () => { this.trip = null; });
    this.socket.on("connect_error", err => this.onConnectError(err));
    this.socket.on("session:replaced", () => {
      this.log(`${this.username}: bị thay bởi thiết bị khác → dừng xe ${this.plate}`);
      this.stop(false);
    });
  }

  async beginTrip() {
    try {
      const ack = await this.socket.timeout(5000).emitWithAck("trip:start", { schedule_id: this.schedule.schedule_id });
      if (!ack.ok) return this.fail(`trip:start bị từ chối (${ack.error})`);
      this.trip = ack.trip;
      this.relogged = false;
      this.log(`${this.username}: xe ${this.plate} chạy Tuyến ${ack.trip.route_number} chiều ${ack.trip.direction}`);
      if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    } catch (err) {
      this.log(`${this.username}: trip:start không phản hồi (${err.message})`);
    }
  }

  async onConnectError(err) {
    if (this.stopped) return;
    // Lỗi tầng mạng: socket.io tự kết nối lại (socket.active = true)
    if (this.socket.active) return this.log(`${this.username}: mất kết nối socket (${err.message}), đang thử lại`);
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
    if (!this.trip || !this.socket?.connected) return;
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
