/**
 * SUITE KIỂM THỬ TOÀN DIỆN HỆ THỐNG WEB GIS XE BUÝT 2D (AUTOMATED TEST SUITE)
 * Chạy trước buổi Demo để quét toàn bộ CSDL, REST APIs, WebSocket Realtime, Phân quyền & Giả lập GPS.
 */

const mysql = require("mysql2/promise");
const http = require("http");
const { io } = require("socket.io-client");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const API_BASE = "http://localhost:3000/api/v1";
const SOCKET_URL = "http://localhost:3000";

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "bus_management_db"
};

let passedTests = 0;
let failedTests = 0;
const testResults = [];

function logPass(title, details = "") {
  passedTests++;
  console.log(`  \x1b[32m✔ PASS\x1b[0m [${title}] ${details}`);
  testResults.push({ title, status: "PASS", details });
}

function logFail(title, error) {
  failedTests++;
  console.log(`  \x1b[31m✘ FAIL\x1b[0m [${title}] => Lỗi: ${error}`);
  testResults.push({ title, status: "FAIL", error: error.toString() });
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, error: e.message });
        }
      });
    });

    req.on("error", (err) => reject(err));

    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

const DRIVER_PASSWORD = process.env.SEED_DRIVER_PASSWORD || "driver123";

function driverLogin(username, password = DRIVER_PASSWORD) {
  return fetchJson(`${API_BASE}/auth/driver/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { username, password }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chờ sự kiện thỏa điều kiện; hết giờ → reject
function waitFor(socket, event, match = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const handler = data => {
      if (!match(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout ${ms}ms chờ '${event}'`));
    }, ms);
    socket.on(event, handler);
  });
}

// true nếu KHÔNG nhận sự kiện thỏa điều kiện trong ms
const expectNone = (socket, event, match, ms = 1000) => waitFor(socket, event, match, ms).then(() => false, () => true);

const waitConnect = socket => new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});

async function runTestSuite() {
  console.log("\n=======================================================================");
  console.log("   KIỂM THỬ HỆ THỐNG WEB GIS XE BUÝT 2D TRƯỚC DEMO (AUTOMATED TEST)   ");
  console.log("=======================================================================\n");

  let adminToken = "";
  let managerToken = "";
  let dbConn = null;

  // ------------------------------------------------------------------
  // 1. KIỂM TRA CƠ SỞ DỮ LIỆU MYSQL SPATIAL
  // ------------------------------------------------------------------
  console.log("\x1b[36m▶ [MODULE 1]: Kiểm Tra Cơ Sở Dữ Liệu MySQL Spatial & Bảng Dữ Liệu\x1b[0m");
  try {
    dbConn = await mysql.createConnection(dbConfig);
    logPass("Kết nối CSDL", `Đã kết nối thành công tới database: '${dbConfig.database}'`);

    const requiredTables = [
      "users",
      "bus_routes",
      "route_paths",
      "bus_stops",
      "route_stops",
      "vehicles",
      "schedules",
      "vehicle_tracking_logs"
    ];

    const [tables] = await dbConn.query("SHOW TABLES");
    const existingTableNames = tables.map((t) => Object.values(t)[0]);

    for (const t of requiredTables) {
      if (existingTableNames.includes(t)) {
        logPass(`Bảng CSDL: ${t}`, "Tồn tại cấu trúc chuẩn");
      } else {
        logFail(`Bảng CSDL: ${t}`, "Không tìm thấy bảng trong CSDL");
      }
    }

    // Kiểm tra tính toàn vẹn tọa độ Spatial (SRID 4326)
    const [stopsSample] = await dbConn.query("SELECT stop_id, ST_SRID(geom) as srid, ST_AsText(geom) as wkt FROM bus_stops LIMIT 1");
    if (stopsSample.length > 0 && stopsSample[0].wkt.startsWith("POINT")) {
      logPass("Không gian Spatial SRID", `Trạm mẫu ${stopsSample[0].stop_id}: ${stopsSample[0].wkt}`);
    } else {
      logFail("Không gian Spatial SRID", "Chưa có trạm dừng mẫu chuẩn POINT WKT");
    }
  } catch (err) {
    logFail("Kết nối CSDL", err.message);
  }

  // ------------------------------------------------------------------
  // 2. KIỂM TRA XÁC THỰC & PHÂN QUYỀN (AUTH & RBAC)
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 2]: Kiểm Tra Xác Thực JWT & Phân Quyền Người Dùng\x1b[0m");
  try {
    // 2.1 Đăng nhập Admin
    const adminLogin = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "admin", password: "admin123" }
    });

    if (adminLogin.status === 200 && adminLogin.data.token && adminLogin.data.user.role === "ADMIN") {
      adminToken = adminLogin.data.token;
      logPass("Đăng nhập Admin (admin/admin123)", `Token JWT cấp thành công, Role: ${adminLogin.data.user.role}`);
    } else {
      logFail("Đăng nhập Admin", `Status ${adminLogin.status}: ${JSON.stringify(adminLogin.data)}`);
    }

    // 2.2 Đăng nhập Khách bị loại bỏ (bản đồ công khai, chỉ ADMIN/MANAGER được đăng nhập)
    const guestLogin = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "khach", password: "khach123" }
    });

    if (guestLogin.status === 401 || guestLogin.status === 403) {
      logPass("Đăng nhập Khách bị từ chối (khach/khach123)", `Máy chủ từ chối với mã ${guestLogin.status}`);
    } else {
      logFail("Đăng nhập Khách bị từ chối", `Mong đợi 401/403 nhưng nhận được ${guestLogin.status}`);
    }

    const managerLogin = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "manager", password: "manager123" }
    });
    if (managerLogin.status === 200 && managerLogin.data.token) {
      managerToken = managerLogin.data.token;
    }

    // 2.3 Đăng nhập sai mật khẩu (Bảo mật)
    const failedLogin = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "admin", password: "sai_mat_khau_123" }
    });

    if (failedLogin.status === 401) {
      logPass("Bảo mật Đăng nhập Sai Mật khẩu", "Máy chủ từ chối mã 401 Unauthorized chính xác");
    } else {
      logFail("Bảo mật Đăng nhập Sai Mật khẩu", `Mong đợi 401 nhưng nhận được ${failedLogin.status}`);
    }

    // 2.4 Kiểm tra phân quyền RBAC: Manager cố truy cập API Quản lý Users (Admin only)
    const managerAccessUsers = await fetchJson(`${API_BASE}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${managerToken}`
      },
      body: { username: "fake_user", password: "123", full_name: "Fake" }
    });

    if (managerToken && managerAccessUsers.status === 403) {
      logPass("Bảo mật RBAC (Manager tạo User)", "Bị chặn với mã 403 Forbidden chính xác");
    } else {
      logFail("Bảo mật RBAC (Manager tạo User)", `Lỗ hổng bảo mật! Nhận status: ${managerAccessUsers.status}`);
    }

    // 2.5 Tài khoản tài xế: chỉ đăng nhập ở cổng tài xế, không gọi được API quản trị
    const driver = await driverLogin("driver01");
    if (driver.status === 200 && driver.data.user.role === "DRIVER" && driver.data.user.vehicle_id) {
      logPass("Đăng nhập Tài xế (/auth/driver/login)", `driver01 → xe ${driver.data.user.vehicle_id}`);
    } else {
      logFail("Đăng nhập Tài xế", `Status ${driver.status} (đã chạy npm run db:seed-drivers chưa?)`);
    }

    const driverAtStaff = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "driver01", password: DRIVER_PASSWORD }
    });
    const adminAtDriver = await driverLogin("admin", "admin123");
    if (driverAtStaff.status === 403 && adminAtDriver.status === 403) {
      logPass("Tách cổng đăng nhập", "Tài xế bị chặn ở cổng nhân viên và ngược lại (403)");
    } else {
      logFail("Tách cổng đăng nhập", `driver@staff=${driverAtStaff.status}, admin@driver=${adminAtDriver.status}`);
    }

    const driverAuth = { "Content-Type": "application/json", "Authorization": `Bearer ${driver.data.token}` };
    const driverWrite = await fetchJson(`${API_BASE}/routes`, { method: "POST", headers: driverAuth, body: { route_id: "HACK" } });
    const driverExport = await fetchJson(`${API_BASE}/export/json`, { headers: driverAuth });
    if (driverWrite.status === 403 && driverExport.status === 403) {
      logPass("Bảo mật RBAC (Tài xế gọi API quản trị)", "POST /routes và GET /export/json bị chặn 403");
    } else {
      logFail("Bảo mật RBAC (Tài xế gọi API quản trị)", `POST /routes=${driverWrite.status}, GET /export/json=${driverExport.status}`);
    }

    const badRole = await fetchJson(`${API_BASE}/users/0`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: { full_name: "x", email: "", role: "SUPERUSER" }
    });
    if (badRole.status === 400) {
      logPass("Whitelist vai trò người dùng", "role SUPERUSER bị từ chối 400");
    } else {
      logFail("Whitelist vai trò người dùng", `Mong đợi 400 nhưng nhận ${badRole.status}`);
    }
  } catch (err) {
    logFail("Module Auth & RBAC", err.message);
  }

  // ------------------------------------------------------------------
  // 3. KIỂM TRA TOÀN BỘ DANH MỤC REST APIS & DỮ LIỆU GIS
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 3]: Kiểm Tra Toàn Diện Danh Mục RESTful APIs & GeoJSON\x1b[0m");
  try {
    // 3.1 Tuyến xe (GET /routes)
    const routesRes = await fetchJson(`${API_BASE}/routes`);
    if (routesRes.status === 200 && Array.isArray(routesRes.data) && routesRes.data.length > 0) {
      logPass("API GET /routes", `Tải thành công ${routesRes.data.length} tuyến xe buýt`);
    } else {
      logFail("API GET /routes", `Lỗi tải tuyến: ${routesRes.status}`);
    }

    // Tuyến mẫu: tuyến đầu tiên có lộ trình trong CSDL (dữ liệu TP.HCM nạp từ busdata.sql)
    const sampleRoute = (Array.isArray(routesRes.data) && routesRes.data.find(r => r.total_paths > 0)) || { route_id: "1", route_number: "01" };

    // 3.2 Lộ trình đơn tuyến (GET /routes/:id/path?direction=1)
    const pathRes = await fetchJson(`${API_BASE}/routes/${sampleRoute.route_id}/path?direction=1`);
    if (pathRes.status === 200 && pathRes.data.type === "Feature" && pathRes.data.geometry.type === "LineString") {
      logPass("API GET /routes/:id/path", `Lộ trình LineString Tuyến ${sampleRoute.route_number} chuẩn GeoJSON (${pathRes.data.geometry.coordinates.length} điểm)`);
    } else {
      logFail("API GET /routes/:id/path", `Dữ liệu không đúng chuẩn Feature LineString: ${pathRes.status}`);
    }

    // 3.3 Toàn bộ lộ trình (GET /paths)
    const allPathsRes = await fetchJson(`${API_BASE}/paths`);
    if (allPathsRes.status === 200 && allPathsRes.data.type === "FeatureCollection") {
      logPass("API GET /paths", `Tải thành công toàn bộ ${allPathsRes.data.features.length} lộ trình tim đường`);
    } else {
      logFail("API GET /paths", `Lỗi tải danh mục /paths: ${allPathsRes.status}`);
    }

    // 3.4 Trạm dừng (GET /stops)
    const stopsRes = await fetchJson(`${API_BASE}/stops`);
    if (stopsRes.status === 200 && stopsRes.data.type === "FeatureCollection" && stopsRes.data.features.length > 0) {
      logPass("API GET /stops", `Tải thành công ${stopsRes.data.features.length} trạm dừng chuẩn GeoJSON Point`);
    } else {
      logFail("API GET /stops", `Lỗi tải trạm dừng: ${stopsRes.status}`);
    }

    // 3.5 Trạm theo tuyến (GET /routes/:id/stops?direction=1)
    const routeStopsRes = await fetchJson(`${API_BASE}/routes/${sampleRoute.route_id}/stops?direction=1`);
    if (routeStopsRes.status === 200 && Array.isArray(routeStopsRes.data)) {
      logPass("API GET /routes/:id/stops", `Tải thành công ${routeStopsRes.data.length} trạm theo thứ tự đón khách`);
    } else {
      logFail("API GET /routes/:id/stops", `Lỗi tải trạm theo tuyến: ${routeStopsRes.status}`);
    }

    // 3.6 Đội xe (GET /vehicles)
    const vehRes = await fetchJson(`${API_BASE}/vehicles`);
    if (vehRes.status === 200 && Array.isArray(vehRes.data) && vehRes.data.length > 0) {
      logPass("API GET /vehicles", `Tải thành công ${vehRes.data.length} phương tiện xe buýt`);
    } else {
      logFail("API GET /vehicles", `Lỗi tải phương tiện: ${vehRes.status}`);
    }

    // 3.7 Phân công Lịch trình (GET /schedules)
    const schRes = await fetchJson(`${API_BASE}/schedules`);
    if (schRes.status === 200 && Array.isArray(schRes.data)) {
      logPass("API GET /schedules", `Tải thành công ${schRes.data.length} chuyến xe đã phân công`);
    } else {
      logFail("API GET /schedules", `Lỗi tải lịch trình: ${schRes.status}`);
    }

    // 3.8 Báo cáo Thống kê Dashboard (GET /admin/stats)
    const statsRes = await fetchJson(`${API_BASE}/admin/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (statsRes.status === 200 && statsRes.data.routes !== undefined) {
      logPass("API GET /admin/stats", `Thống kê: ${statsRes.data.routes} tuyến, ${statsRes.data.stops} trạm, ${statsRes.data.vehicles} xe`);
    } else {
      logFail("API GET /admin/stats", `Lỗi thống kê: ${statsRes.status}`);
    }

    // 3.9 Tìm tuyến cho khách (GET /trip-plan): đứng tại trạm đầu tuyến mẫu, đến trạm thứ 5 cùng chiều
    const sampleStops = Array.isArray(routeStopsRes.data) ? routeStopsRes.data : [];
    if (sampleStops.length >= 2) {
      const boardStop = sampleStops[0];
      const alightStop = sampleStops[Math.min(4, sampleStops.length - 1)];

      const planRes = await fetchJson(`${API_BASE}/trip-plan?to_stop_id=${alightStop.stop_id}&from_lat=${boardStop.latitude}&from_lng=${boardStop.longitude}`);
      const planResults = (planRes.data && planRes.data.results) || [];
      const sampleHit = planResults.find(r => String(r.route_id) === String(sampleRoute.route_id) && Number(r.direction) === 1);
      if (planRes.status === 200 && sampleHit && sampleHit.board_stop.stop_order < sampleHit.alight_stop.stop_order) {
        logPass("API GET /trip-plan (có GPS)", `${planResults.length} tuyến; Tuyến ${sampleRoute.route_number} lên tại '${sampleHit.board_stop.stop_name}', xuống tại '${sampleHit.alight_stop.stop_name}' (${sampleHit.num_stops} trạm)`);
      } else {
        logFail("API GET /trip-plan (có GPS)", `Status ${planRes.status}, không thấy Tuyến ${sampleRoute.route_number} chiều đi trong kết quả`);
      }

      const wrongWay = planResults.filter(r => !r.board_stop || r.board_stop.stop_order >= r.alight_stop.stop_order);
      if (planResults.length > 0 && wrongWay.length === 0) {
        logPass("API GET /trip-plan (đúng chiều)", "Mọi kết quả đều lên xe trước khi xuống xe trên cùng chiều chạy");
      } else {
        logFail("API GET /trip-plan (đúng chiều)", `${wrongWay.length} kết quả sai chiều chạy`);
      }

      // Khách ở xa (~10 km): không giới hạn bán kính, vẫn liệt kê tuyến, trạm lên gần khách nhất xếp trước
      const farRes = await fetchJson(`${API_BASE}/trip-plan?to_stop_id=${alightStop.stop_id}&from_lat=${boardStop.latitude + 0.09}&from_lng=${boardStop.longitude}`);
      const farResults = (farRes.data && farRes.data.results) || [];
      const farSorted = farResults.every((r, i) => i === 0 || farResults[i - 1].board_stop.walk_m <= r.board_stop.walk_m);
      if (farRes.status === 200 && farResults.length > 0 && farSorted) {
        logPass("API GET /trip-plan (khách ở xa)", `${farResults.length} tuyến, trạm lên gần nhất cách ${farResults[0].board_stop.walk_m} m`);
      } else {
        logFail("API GET /trip-plan (khách ở xa)", `Status ${farRes.status}, ${farResults.length} tuyến, sắp xếp đúng: ${farSorted}`);
      }

      // Không có GPS: liệt kê mọi tuyến dừng gần trạm đích
      const noGpsRes = await fetchJson(`${API_BASE}/trip-plan?to_stop_id=${alightStop.stop_id}`);
      const noGpsResults = (noGpsRes.data && noGpsRes.data.results) || [];
      if (noGpsRes.status === 200 && noGpsRes.data.has_origin === false && noGpsResults.some(r => String(r.route_id) === String(sampleRoute.route_id))) {
        logPass("API GET /trip-plan (không GPS)", `${noGpsResults.length} tuyến dừng gần trạm '${alightStop.stop_name}'`);
      } else {
        logFail("API GET /trip-plan (không GPS)", `Status ${noGpsRes.status}, thiếu Tuyến ${sampleRoute.route_number}`);
      }
    } else {
      logFail("API GET /trip-plan", `Tuyến mẫu ${sampleRoute.route_number} không đủ trạm để kiểm thử`);
    }

    const missingDest = await fetchJson(`${API_BASE}/trip-plan`);
    if (missingDest.status === 400) {
      logPass("API GET /trip-plan (thiếu điểm đến)", "Từ chối với mã 400");
    } else {
      logFail("API GET /trip-plan (thiếu điểm đến)", `Mong đợi 400 nhưng nhận được ${missingDest.status}`);
    }
  } catch (err) {
    logFail("Module RESTful APIs", err.message);
  }

  // ------------------------------------------------------------------
  // 4. KIỂM TRA WEBSOCKET: VIEWER "/" (CHỈ NHẬN) + THIẾT BỊ TÀI XẾ "/device"
  //    Cần seed ≥ 2 tài xế: npm run db:seed-drivers
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 4]: Kiểm Tra WebSocket Realtime (viewer + /device tài xế)\x1b[0m");
  const sockets = [];
  const openSocket = (nsp, auth = {}) => {
    const s = io(`${SOCKET_URL}${nsp}`, { auth, reconnection: false, forceNew: true, timeout: 4000 });
    sockets.push(s);
    return s;
  };
  try {
    const d1 = await driverLogin("driver01");
    const d2 = await driverLogin("driver02");
    if (d1.status !== 200 || d2.status !== 200) {
      throw new Error(`Chưa seed tài xế (driver01=${d1.status}, driver02=${d2.status}) → chạy npm run db:seed-drivers`);
    }
    const auth1 = { "Authorization": `Bearer ${d1.data.token}` };
    const auth2 = { "Authorization": `Bearer ${d2.data.token}` };
    const sch1 = (await fetchJson(`${API_BASE}/driver/me`, { headers: auth1 })).data.schedules[0];
    const sch2 = (await fetchJson(`${API_BASE}/driver/me`, { headers: auth2 })).data.schedules[0];
    const vehicleId = d1.data.user.vehicle_id;

    // Nhân viên nhận mọi xe (room staff); khách chỉ nhận chuyến mình trip:watch
    const viewer = openSocket("", { token: adminToken });
    const guest = openSocket("");
    await Promise.all([waitConnect(viewer), waitConnect(guest)]);
    logPass("Kết nối viewer '/'", `Nhân viên + khách đã kết nối Socket.io tại ${SOCKET_URL}`);

    // 4.1 /device không token / token nhân viên
    const noToken = await waitConnect(openSocket("/device")).then(() => "connected", e => e.message);
    const staffToken = await waitConnect(openSocket("/device", { token: adminToken })).then(() => "connected", e => e.message);
    if (noToken === "UNAUTHORIZED" && staffToken === "UNAUTHORIZED") {
      logPass("Bảo mật /device", "Không token và token ADMIN đều bị từ chối UNAUTHORIZED");
    } else {
      logFail("Bảo mật /device", `không token=${noToken}, token ADMIN=${staffToken}`);
    }

    // 4.2 Viewer phát gps_ping giả → không ai nhận
    const viewer2 = openSocket("");
    await waitConnect(viewer2);
    const noLeak = expectNone(viewer, "fleet_location_update", d => d.vehicle_id === "BUS_FAKE");
    viewer2.emit("gps_ping", { vehicle_id: "BUS_FAKE", latitude: 10.87, longitude: 106.8 });
    if (await noLeak) logPass("Viewer không phát được GPS", "gps_ping từ namespace '/' bị bỏ qua");
    else logFail("Viewer không phát được GPS", "Gói giả từ viewer bị phát lại!");

    // 4.3 Thiết bị tài xế: lịch trình xe khác bị từ chối, lịch trình của mình được nhận
    const dev = openSocket("/device", { token: d1.data.token });
    await waitConnect(dev);
    const badTrip = await dev.timeout(3000).emitWithAck("trip:start", { schedule_id: sch2.schedule_id });
    if (badTrip.ok === false && badTrip.error === "SCHEDULE_NOT_ALLOWED") {
      logPass("trip:start lịch trình xe khác", "Bị từ chối SCHEDULE_NOT_ALLOWED");
    } else {
      logFail("trip:start lịch trình xe khác", JSON.stringify(badTrip));
    }

    const trip = await dev.timeout(3000).emitWithAck("trip:start", { schedule_id: sch1.schedule_id });
    const gotLocation = waitFor(viewer, "fleet_location_update", d => d.vehicle_id === vehicleId);
    const guestSilent = expectNone(guest, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { vehicle_id: "DRV_99", latitude: 10.87052, longitude: 106.80196, speed_kmh: 35, heading: 90 });
    const loc = await gotLocation;
    if (trip.ok && loc.vehicle_id === vehicleId && loc.route_id === sch1.route_id && loc.schedule_id === sch1.schedule_id && loc.timestamp) {
      logPass("Luồng GPS tài xế → nhân viên", `Xe ${loc.plate_number} | Tuyến ${loc.route_number} | chuyến ${loc.schedule_id} (vehicle_id giả bị bỏ)`);
    } else {
      logFail("Luồng GPS tài xế → nhân viên", JSON.stringify({ trip, loc }));
    }
    if (await guestSilent) logPass("Khách chưa chọn chuyến", "Không nhận vị trí xe nào");
    else logFail("Khách chưa chọn chuyến", "Khách nhận được vị trí khi chưa trip:watch!");

    // 4.3b Khách xem danh sách chuyến của tuyến (không tọa độ) rồi theo dõi đúng chuyến đang chạy
    const subscribed = await guest.timeout(3000).emitWithAck("trips:subscribe", { route_id: sch1.route_id, direction: sch1.direction });
    const listed = subscribed.ok && subscribed.trips.find(x => x.schedule_id === sch1.schedule_id);
    if (listed && listed.status === "RUNNING" && !/longitude|latitude/.test(JSON.stringify(subscribed.trips))) {
      logPass("trips:subscribe", `${subscribed.trips.length} chuyến, chuyến ${sch1.schedule_id} đang chạy, không lộ tọa độ`);
    } else {
      logFail("trips:subscribe", JSON.stringify(subscribed));
    }
    const watched = await guest.timeout(3000).emitWithAck("trip:watch", { schedule_id: sch1.schedule_id });
    await sleep(300);
    const guestLocation = waitFor(guest, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { latitude: 10.8706, longitude: 106.8020, speed_kmh: 35, heading: 90 });
    const guestLoc = await guestLocation;
    if (watched.ok && guestLoc.schedule_id === sch1.schedule_id) {
      logPass("trip:watch", `Khách nhận đúng xe ${guestLoc.plate_number} của chuyến ${sch1.schedule_id}`);
    } else {
      logFail("trip:watch", JSON.stringify({ watched, guestLoc }));
    }

    // 4.4 Gói sai định dạng không được phát
    await sleep(300);
    const noInvalid = expectNone(viewer, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { latitude: 999, longitude: 106.8 });
    if (await noInvalid) logPass("Validate gói GPS", "latitude = 999 bị bỏ");
    else logFail("Validate gói GPS", "Gói sai định dạng vẫn được phát");

    // 4.5 Phiên thứ hai cùng xe thay phiên cũ
    const replaced = waitFor(dev, "session:replaced");
    const dev2 = openSocket("/device", { token: d1.data.token });
    await waitConnect(dev2);
    await replaced;
    logPass("Một xe một phiên", "Phiên cũ nhận session:replaced");

    // 4.6 Kết thúc chuyến → viewer nhận vehicle_offline
    await dev2.timeout(3000).emitWithAck("trip:start", { schedule_id: sch1.schedule_id });
    const offline = waitFor(viewer, "vehicle_offline", d => d.vehicle_id === vehicleId);
    await dev2.timeout(3000).emitWithAck("trip:end", {});
    await offline;
    logPass("Kết thúc chuyến", `Nhân viên nhận vehicle_offline cho ${vehicleId}`);
  } catch (err) {
    logFail("Module WebSocket Realtime", err.message);
  } finally {
    sockets.forEach(s => s.disconnect());
  }

  // ------------------------------------------------------------------
  // 5. KIỂM TRA TỆP TIN GIAO DIỆN FRONTEND & CÔNG CỤ
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 5]: Kiểm Tra Tính Toàn Vẹn Giao Diện & Mã Nguồn Frontend\x1b[0m");
  const frontendFiles = [
    { path: path.join(__dirname, "../frontend/index.html"), name: "Màn hình Bản đồ Giám sát 2D (frontend/index.html)" },
    { path: path.join(__dirname, "../frontend/admin.html"), name: "Cổng Quản trị Admin Portal (frontend/admin.html)" },
    { path: path.join(__dirname, "../frontend/driver.html"), name: "Trang Tài xế (frontend/driver.html)" },
    { path: path.join(__dirname, "../tools/get_coords_1.html"), name: "Bộ trích xuất lộ trình & trạm (tools/get_coords_1.html)" }
  ];

  for (const file of frontendFiles) {
    if (fs.existsSync(file.path)) {
      const content = fs.readFileSync(file.path, "utf8");
      if (content.length > 500 && content.includes("<html")) {
        logPass(file.name, `Kích thước: ${(content.length / 1024).toFixed(1)} KB`);
      } else {
        logFail(file.name, "Tập tin rỗng hoặc không đúng định dạng HTML");
      }
    } else {
      logFail(file.name, "Không tìm thấy tập tin trên đĩa");
    }
  }

  if (dbConn) await dbConn.end();

  // ------------------------------------------------------------------
  // TỔNG KẾT BÁO CÁO KIỂM THỬ
  // ------------------------------------------------------------------
  console.log("\n=======================================================================");
  console.log(`   KẾT QUẢ KIỂM THỬ TỔNG HỢP: ${passedTests} ĐẠT (PASS) / ${failedTests} LỖI (FAIL)   `);
  if (failedTests === 0) {
    console.log("   \x1b[32m✔ HỆ THỐNG ĐẠT 100% TIÊU CHUẨN KỸ THUẬT, SẴN SÀNG DEMO HOÀN HẢO!\x1b[0m   ");
  } else {
    console.log(`   \x1b[31m⚠ PHÁT HIỆN ${failedTests} VẤN ĐỀ CẦN LƯU Ý TRƯỚC KHI DEMO.\x1b[0m   `);
  }
  console.log("=======================================================================\n");
}

runTestSuite();
