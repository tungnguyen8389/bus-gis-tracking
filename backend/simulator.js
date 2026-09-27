const { io } = require("socket.io-client");
const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const SOCKET_SERVER_URL = process.env.SOCKET_URL || "http://localhost:3000";
const socket = io(SOCKET_SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 2000
});

// Cấu hình CSDL MySQL
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "bus_management_db"
};

// Hàm tính khoảng cách thực tế giữa 2 tọa độ GPS (Công thức Haversine theo mét)
function getDistanceMeters(p1, p2) {
  const R = 6371000; // Bán kính Trái Đất (mét)
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLon = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Tiền xử lý lộ trình: Tính toán tích lũy khoảng cách từng đoạn và góc phương vị
function processRouteGeometry(coords) {
  if (!coords || coords.length < 2) return null;
  const segments = [];
  let totalDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dist = getDistanceMeters(p1, p2);

    const dLon = p2[0] - p1[0];
    const dLat = p2[1] - p1[1];
    let heading = 0;
    if (dLon !== 0 || dLat !== 0) {
      heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }

    segments.push({
      p1,
      p2,
      dist,
      startDist: totalDist,
      endDist: totalDist + dist,
      heading
    });
    totalDist += dist;
  }

  return {
    coords,
    segments,
    totalDist: Math.max(10, totalDist)
  };
}

// Nội suy tọa độ chính xác [lon, lat] và góc xoay dựa trên quãng đường đã đi (mét)
function getInterpolatedPosition(processedRoute, distMeters) {
  const { segments, totalDist } = processedRoute;
  const targetDist = ((distMeters % totalDist) + totalDist) % totalDist;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (targetDist >= seg.startDist && targetDist <= seg.endDist) {
      const segRatio = seg.dist > 0 ? (targetDist - seg.startDist) / seg.dist : 0;
      const lon = seg.p1[0] + (seg.p2[0] - seg.p1[0]) * segRatio;
      const lat = seg.p1[1] + (seg.p2[1] - seg.p1[1]) * segRatio;
      return {
        longitude: lon,
        latitude: lat,
        heading: parseFloat(seg.heading.toFixed(1))
      };
    }
  }

  const last = segments[segments.length - 1];
  return {
    longitude: last.p2[0],
    latitude: last.p2[1],
    heading: parseFloat(last.heading.toFixed(1))
  };
}

// Tuyến fallback dự phòng
const fallbackWaypoints = [
  [106.795000, 10.863000],
  [106.798000, 10.866000],
  [106.800000, 10.870000],
  [106.801960, 10.870525],
  [106.803300, 10.877800],
  [106.805500, 10.868500]
];

let dbProcessedRoutes = {}; // Map chứa các tuyến đã tính toán phân đoạn
let simulatedBuses = []; // Danh sách xe buýt đang mô phỏng

/**
 * Tải toàn bộ lộ trình và phương tiện từ CSDL MySQL
 */
async function loadDataFromDatabase() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // 1. Tải tất cả tuyến và lộ trình tim đường (route_paths)
    const [pathRows] = await connection.query(`
      SELECT p.path_id, p.route_id, p.direction, ST_AsGeoJSON(p.geom) AS geom_json, 
             r.route_number, r.route_name
      FROM route_paths p
      JOIN bus_routes r ON p.route_id = r.route_id
      ORDER BY p.route_id ASC, p.direction ASC
    `);

    const newProcessedMap = {};
    for (const row of pathRows) {
      if (row.geom_json) {
        try {
          const geom = JSON.parse(row.geom_json);
          if (geom.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
            const processed = processRouteGeometry(geom.coordinates);
            if (processed) {
              const pathKey = `${row.route_id}_D${row.direction}`;
              newProcessedMap[pathKey] = {
                route_id: row.route_id,
                route_number: row.route_number,
                route_name: row.route_name,
                direction: row.direction,
                ...processed
              };
            }
          }
        } catch (e) {
          console.warn(`[Simulator] Lỗi parse geom JSON tuyến ${row.route_id}:`, e.message);
        }
      }
    }

    if (Object.keys(newProcessedMap).length > 0) {
      dbProcessedRoutes = newProcessedMap;
    } else {
      console.warn(">>> [Simulator] CSDL chưa có dữ liệu route_paths. Sử dụng tuyến fallback.");
      const fallbackProcessed = processRouteGeometry(fallbackWaypoints);
      dbProcessedRoutes["BUS_01_D1"] = {
        route_id: "BUS_01",
        route_number: "08",
        route_name: "Tuyến ĐHQG - Bến Thành",
        direction: 1,
        ...fallbackProcessed
      };
    }

    // 2. Tải danh sách lịch trình phân công xe trong CSDL
    const [schedules] = await connection.query(`
      SELECT s.schedule_id, s.route_id, s.direction, s.vehicle_id,
             v.plate_number, v.driver_name, v.status
      FROM schedules s
      JOIN vehicles v ON s.vehicle_id = v.vehicle_id
      WHERE v.status = 'ACTIVE' OR v.status IS NULL
    `);

    // 3. Khởi tạo danh sách xe buýt đảm bảo KHÔNG BỊ TRÙNG LẶP ID và MỌI TUYẾN ĐỀU CÓ XE
    const existingDistances = {};
    simulatedBuses.forEach(b => {
      existingDistances[b.vehicle_id] = b.currentDistance;
    });

    const newSimulatedList = [];
    const usedVehIds = new Set();
    const routeKeys = Object.keys(dbProcessedRoutes);

    routeKeys.forEach((key) => {
      const rInfo = dbProcessedRoutes[key];
      const totalDist = rInfo.totalDist;

      // Tìm các xe được phân công cho tuyến và chiều này trong schedules
      const assignedSchedules = schedules.filter(s => s.route_id === rInfo.route_id && s.direction === rInfo.direction);

      if (assignedSchedules.length > 0) {
        assignedSchedules.forEach((sch, idx) => {
          // Định danh duy nhất cho từng phiên xe theo tuyến và mã lịch trình để tránh trùng lặp phát sóng
          const uniqueVehId = `${sch.vehicle_id}_${rInfo.route_id}_D${rInfo.direction}_S${sch.schedule_id || (idx + 1)}`;
          usedVehIds.add(sch.vehicle_id);

          const oldDist = existingDistances[uniqueVehId];
          const distOffset = oldDist !== undefined ? oldDist : (idx * (totalDist / assignedSchedules.length));

          newSimulatedList.push({
            vehicle_id: uniqueVehId,
            plate_number: sch.plate_number,
            route_id: rInfo.route_id,
            route_number: rInfo.route_number,
            direction: rInfo.direction,
            route_key: key,
            currentDistance: distOffset % totalDist,
            speedKmh: 30 + (idx * 2)
          });
        });
      } else {
        // Tự động tạo 2-3 xe buýt cho tuyến để luôn có xe di chuyển
        const count = totalDist > 5000 ? 3 : 2;
        for (let i = 1; i <= count; i++) {
          const safeRouteId = rInfo.route_id.replace(/[^a-zA-Z0-9]/g, "");
          const uniqueVehId = `BUS_${safeRouteId}_D${rInfo.direction}_V${i}`;
          const cleanNum = rInfo.route_number ? rInfo.route_number.replace(/[^0-9]/g, "") : "51";
          const plateNum = `51B-${cleanNum.padStart(2, "0")}.${(i * 11).toString().padStart(2, "0")}`;

          const oldDist = existingDistances[uniqueVehId];
          const distOffset = oldDist !== undefined ? oldDist : ((i - 1) * (totalDist / count));

          newSimulatedList.push({
            vehicle_id: uniqueVehId,
            plate_number: plateNum,
            route_id: rInfo.route_id,
            route_number: rInfo.route_number,
            direction: rInfo.direction,
            route_key: key,
            currentDistance: distOffset % totalDist,
            speedKmh: 30 + (i * 3)
          });
        }
      }
    });

    simulatedBuses = newSimulatedList;
    console.log(`>>> [Simulator] Đồng bộ ${Object.keys(dbProcessedRoutes).length} lộ trình CSDL -> Vận hành ${simulatedBuses.length} xe buýt riêng biệt.`);
  } catch (error) {
    console.error(">>> [Simulator Lỗi CSDL]:", error.message);
  } finally {
    if (connection) await connection.end();
  }
}

// --------------------------------------------------------------------
// TIẾN TRÌNH PHÁT TỌA ĐỘ GPS NỘI SUY MƯỢT MỖI 1 GIÂY
// --------------------------------------------------------------------
const TICK_INTERVAL_MS = 1000; // Phát mỗi 1 giây (1000ms) để di chuyển cực kỳ mượt mà

async function startSimulator() {
  await loadDataFromDatabase();

  // Định kỳ tự động cập nhật CSDL mỗi 30 giây
  setInterval(async () => {
    await loadDataFromDatabase();
  }, 30000);

  // Phát gói tin định vị GPS
  setInterval(() => {
    if (!socket.connected || simulatedBuses.length === 0) return;

    simulatedBuses.forEach((bus) => {
      const rInfo = dbProcessedRoutes[bus.route_key];
      if (!rInfo || !rInfo.segments || rInfo.segments.length === 0) return;

      // Vận tốc dao động nhẹ tự nhiên
      const currentSpeed = Math.max(15, bus.speedKmh + (Math.sin(Date.now() / 5000) * 3));
      
      // Quãng đường di chuyển trong 1 giây (mét): v (m/s) = speed (km/h) / 3.6
      const metersPerSec = (currentSpeed * 1000) / 3600;
      const deltaMeters = metersPerSec * (TICK_INTERVAL_MS / 1000);

      // Cập nhật vị trí quãng đường
      bus.currentDistance = (bus.currentDistance + deltaMeters) % rInfo.totalDist;

      // Nội suy tọa độ chính xác và góc xoay
      const pos = getInterpolatedPosition(rInfo, bus.currentDistance);

      const packet = {
        vehicle_id: bus.vehicle_id,
        plate_number: bus.plate_number,
        route_id: bus.route_id,
        route_number: bus.route_number,
        direction: bus.direction,
        longitude: parseFloat(pos.longitude.toFixed(6)),
        latitude: parseFloat(pos.latitude.toFixed(6)),
        speed_kmh: Math.round(currentSpeed),
        heading: pos.heading,
        timestamp: new Date().toISOString()
      };

      // Gửi gói tin viễn thông GPS lên Socket Server
      socket.emit("gps_ping", packet);
    });
  }, TICK_INTERVAL_MS);
}

socket.on("connect", () => {
  console.log(`>>> [Simulator] Đã kết nối Socket Hub (${SOCKET_SERVER_URL}). Bắt đầu luồng GPS nội suy mượt...`);
});

socket.on("connect_error", (err) => {
  console.error(">>> [Simulator Lỗi] Không thể kết nối Socket Hub:", err.message);
});

// Bắt đầu chạy
startSimulator();
