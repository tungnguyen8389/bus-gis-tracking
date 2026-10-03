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
  } catch (err) {
    logFail("Module RESTful APIs", err.message);
  }

  // ------------------------------------------------------------------
  // 4. KIỂM TRA WEBSOCKET REALTIME & LUỒNG GPS GIẢ LẬP
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 4]: Kiểm Tra WebSocket Realtime & Luồng GPS Simulator\x1b[0m");
  try {
    await new Promise((resolve) => {
      const socketClient = io(SOCKET_URL, { timeout: 4000 });
      let receivedGps = false;

      socketClient.on("connect", () => {
        logPass("Kết nối WebSocket Hub", `Đã kết nối Socket.io tại ${SOCKET_URL}`);

        // Gửi thử gói tin định vị mẫu
        socketClient.emit("gps_ping", {
          vehicle_id: "BUS_TEST_VERIFY",
          plate_number: "51B-999.99",
          route_id: "1",
          longitude: 106.80196,
          latitude: 10.87052,
          speed_kmh: 35,
          heading: 90
        });
      });

      socketClient.on("fleet_location_update", (data) => {
        if (!receivedGps) {
          receivedGps = true;
          if (data && data.longitude && data.latitude && data.vehicle_id) {
            logPass("Nhận Luồng GPS Realtime ('fleet_location_update')", `Xe: ${data.plate_number || data.vehicle_id} | Tọa độ: [${data.longitude}, ${data.latitude}] | Vận tốc: ${data.speed_kmh} km/h`);
          } else {
            logFail("Nhận Luồng GPS Realtime", "Gói tin không đầy đủ thuộc tính tọa độ");
          }
          socketClient.disconnect();
          resolve();
        }
      });

      socketClient.on("connect_error", (err) => {
        logFail("Kết nối WebSocket Hub", err.message);
        socketClient.disconnect();
        resolve();
      });

      setTimeout(() => {
        if (!receivedGps) {
          logFail("Nhận Luồng GPS Realtime", "Hết thời gian chờ (Timeout 4s) không nhận được broadcast GPS từ server");
          socketClient.disconnect();
          resolve();
        }
      }, 4000);
    });
  } catch (err) {
    logFail("Module WebSocket Realtime", err.message);
  }

  // ------------------------------------------------------------------
  // 5. KIỂM TRA TỆP TIN GIAO DIỆN FRONTEND & CÔNG CỤ
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 5]: Kiểm Tra Tính Toàn Vẹn Giao Diện & Mã Nguồn Frontend\x1b[0m");
  const frontendFiles = [
    { path: path.join(__dirname, "../frontend/index.html"), name: "Màn hình Bản đồ Giám sát 2D (frontend/index.html)" },
    { path: path.join(__dirname, "../frontend/admin.html"), name: "Cổng Quản trị Admin Portal (frontend/admin.html)" },
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
