# TỔNG HỢP MÃ NGUỒN ĐỒ ÁN HỆ THỐNG THÔNG TIN ĐỊA LÝ (IE402)
## ĐỀ TÀI: QUẢN LÝ VÀ GIÁM SÁT HÀNH TRÌNH XE BUÝT 2D TRÊN NỀN WEB GIS

> **Lưu ý:** Tài liệu này là bản tổng hợp mã nguồn giai đoạn đầu, chưa cập nhật theo cấu trúc hiện tại.
> Hub realtime nay nằm ở `backend/src/sockets/` (namespace `/` chỉ nhận, `/device` cho tài xế đã xác thực).
> Bộ giả lập đã tách thành thư mục độc lập `simulator/`.
> Xem [README.md](README.md) và [docs/superpowers/specs/2026-10-04-socket-security-driver-design.md](docs/superpowers/specs/2026-10-04-socket-security-driver-design.md).

---

## MỤC LỤC TẬP TIN NGUỒN
1. `database/schema.sql` - Lược đồ tạo bảng và nạp dữ liệu không gian MySQL 8.x Spatial
2. `backend/package.json` - Cấu hình thư viện Node.js (Express, Socket.io, MySQL2)
3. `backend/server.js` - Máy chủ RESTful API & WebSocket Realtime Broadcast
4. `backend/simulator.js` - *(đã thay bằng thư mục `simulator/` độc lập)* Tiến trình giả lập GPS phát tọa độ xe buýt di chuyển
5. `frontend/index.html` - Màn hình chính tích hợp ArcGIS Maps SDK v4.29 & Dashboard
6. `tools/coordinate_picker.html` - Công cụ Click lấy tọa độ trạm/lộ trình (Coordinate Picker)
7. `tools/google_maps_importer.html` - Công cụ chuyển đổi tọa độ Google Maps sang ArcGIS

---

## 1. Cơ sở dữ liệu: `database/schema.sql`

```sql
-- ====================================================================
-- HỆ THỐNG CƠ SỞ DỮ LIỆU QUẢN LÝ XE BUÝT (MYSQL 8.0 SPATIAL)
-- Hệ quy chiếu: WGS84 (SRID 4326), Quy ước trục: axis-order=long-lat
-- ====================================================================

CREATE DATABASE IF NOT EXISTS bus_management_db 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE bus_management_db;

-- 1. Bảng Tuyến xe buýt (Thực thể thuộc tính)
DROP TABLE IF EXISTS route_stops;
DROP TABLE IF EXISTS route_paths;
DROP TABLE IF EXISTS vehicle_tracking_logs;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS bus_stops;
DROP TABLE IF EXISTS bus_routes;

CREATE TABLE bus_routes (
    route_id VARCHAR(20) PRIMARY KEY,
    route_number VARCHAR(10) NOT NULL,
    route_name VARCHAR(150) NOT NULL,
    distance_km FLOAT DEFAULT 0.0,
    headway_min INT DEFAULT 15
) ENGINE=InnoDB;

-- 2. Bảng Lộ trình tuyến đường (Thực thể Không gian: LineString)
CREATE TABLE route_paths (
    path_id INT AUTO_INCREMENT PRIMARY KEY,
    route_id VARCHAR(20) NOT NULL,
    direction TINYINT NOT NULL COMMENT '1: Đi, 2: Về',
    geom LINESTRING NOT NULL /* SRID 4326 */,
    SPATIAL INDEX(geom),
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Bảng Trạm dừng xe buýt (Thực thể Không gian: Point)
CREATE TABLE bus_stops (
    stop_id VARCHAR(20) PRIMARY KEY,
    stop_name VARCHAR(150) NOT NULL,
    address VARCHAR(255),
    geom POINT NOT NULL /* SRID 4326 */,
    SPATIAL INDEX(geom)
) ENGINE=InnoDB;

-- 4. Bảng liên kết Thứ tự Trạm dừng trên Tuyến (Quan hệ M - N)
CREATE TABLE route_stops (
    route_id VARCHAR(20) NOT NULL,
    stop_id VARCHAR(20) NOT NULL,
    direction TINYINT NOT NULL,
    stop_order INT NOT NULL,
    PRIMARY KEY (route_id, stop_id, direction),
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE,
    FOREIGN KEY (stop_id) REFERENCES bus_stops(stop_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Bảng Phương tiện xe buýt
CREATE TABLE vehicles (
    vehicle_id VARCHAR(20) PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INT DEFAULT 40,
    driver_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ACTIVE'
) ENGINE=InnoDB;

-- 6. Bảng Lịch trình khởi hành
CREATE TABLE schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    route_id VARCHAR(20) NOT NULL,
    vehicle_id VARCHAR(20) NOT NULL,
    departure_time TIME NOT NULL,
    direction TINYINT NOT NULL,
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Bảng Nhật ký vết xe (Spatial Temporal: Điểm động theo thời gian)
CREATE TABLE vehicle_tracking_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id VARCHAR(20) NOT NULL,
    speed_kmh FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    geom POINT NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SPATIAL INDEX(geom),
    INDEX(vehicle_id, recorded_at),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ====================================================================
-- SEED DỮ LIỆU MẪU KHU VỰC ĐẠI HỌC QUỐC GIA TP.HCM
-- ====================================================================

-- Nạp Tuyến
INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min)
VALUES ('BUS_01', '08', 'Bến xe Buýt ĐHQG - Bến Thành', 15.5, 10);

-- Nạp Trạm dừng (Point WGS84)
INSERT INTO bus_stops (stop_id, stop_name, address, geom) VALUES
('ST_01', 'Trạm KTX Khu A', 'Đường Tạ Quang Bửu', ST_GeomFromText('POINT(106.795000 10.863000)', 4326, 'axis-order=long-lat')),
('ST_02', 'Trạm ĐH Khoa học Tự nhiên', 'Đường Vành Đai', ST_GeomFromText('POINT(106.800000 10.870000)', 4326, 'axis-order=long-lat')),
('ST_03', 'Trạm Thư viện Trung tâm', 'Khu trung tâm ĐHQG', ST_GeomFromText('POINT(106.801960 10.870525)', 4326, 'axis-order=long-lat')),
('ST_04', 'Trạm ĐH Quốc Tế', 'Đường Quảng Trường Sáng Tạo', ST_GeomFromText('POINT(106.803300 10.877800)', 4326, 'axis-order=long-lat')),
('ST_05', 'Trạm ĐH Bách Khoa CS2', 'Đường Lê Quý Đôn', ST_GeomFromText('POINT(106.805500 10.868500)', 4326, 'axis-order=long-lat'));

-- Nạp Lộ trình tim đường (LineString WGS84)
INSERT INTO route_paths (route_id, direction, geom) VALUES
('BUS_01', 1, ST_GeomFromText('LINESTRING(106.795000 10.863000, 106.798000 10.866000, 106.800000 10.870000, 106.801960 10.870525, 106.803300 10.877800, 106.805500 10.868500)', 4326, 'axis-order=long-lat'));

-- Gán thứ tự đón khách
INSERT INTO route_stops (route_id, stop_id, direction, stop_order) VALUES
('BUS_01', 'ST_01', 1, 1),
('BUS_01', 'ST_02', 1, 2),
('BUS_01', 'ST_03', 1, 3),
('BUS_01', 'ST_04', 1, 4),
('BUS_01', 'ST_05', 1, 5);

-- Nạp Xe buýt
INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES
('BUS_51B_01', '51B-123.45', 45, 'Nguyễn Văn A', 'ACTIVE'),
('BUS_51B_02', '51B-678.90', 45, 'Trần Văn B', 'ACTIVE');
```

---

## 2. Cấu hình Back-end: `backend/package.json`

```json
{
  "name": "bus-gis-backend",
  "version": "1.0.0",
  "description": "Backend API và Real-time Hub cho Đồ án Web GIS Giám sát xe buýt 2D",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "simulate": "node simulator.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "mysql2": "^3.9.7",
    "socket.io": "^4.7.5"
  }
}
```

---

## 3. Máy chủ dịch vụ: `backend/server.js`

```javascript
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Kết nối CSDL MySQL 8.x Spatial
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "bus_management_db",
  waitForConnections: true,
  connectionLimit: 10
});

// --------------------------------------------------------------------
// RESTFUL APIS (XUẤT DỮ LIỆU GEOJSON CHUẨN)
// --------------------------------------------------------------------

// 1. API: Lấy toàn bộ danh sách trạm dừng dạng GeoJSON FeatureCollection
app.get("/api/v1/stops", async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      `SELECT stop_id, stop_name, address, ST_AsGeoJSON(geom) AS geom_json FROM bus_stops`
    );

    const geojson = {
      type: "FeatureCollection",
      features: rows.map(row => ({
        type: "Feature",
        geometry: JSON.parse(row.geom_json),
        properties: {
          stop_id: row.stop_id,
          stop_name: row.stop_name,
          address: row.address
        }
      }))
    };
    res.json(geojson);
  } catch (error) {
    console.error("Lỗi lấy danh sách trạm:", error);
    res.status(500).json({ error: "Lỗi kết nối cơ sở dữ liệu" });
  }
});

// 2. API: Lấy lộ trình tim đường (Polyline) theo route_id dạng GeoJSON Feature
app.get("/api/v1/routes/:route_id/path", async (req, res) => {
  const { route_id } = req.params;
  try {
    const [rows] = await dbPool.query(
      `SELECT p.path_id, p.route_id, p.direction, r.route_number, r.route_name,
              ST_AsGeoJSON(p.geom) AS geom_json
       FROM route_paths p
       JOIN bus_routes r ON p.route_id = r.route_id
       WHERE p.route_id = ? LIMIT 1`,
      [route_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy tuyến đường" });
    }

    const row = rows[0];
    const geojson = {
      type: "Feature",
      geometry: JSON.parse(row.geom_json),
      properties: {
        path_id: row.path_id,
        route_id: row.route_id,
        route_number: row.route_number,
        route_name: row.route_name,
        direction: row.direction
      }
    };
    res.json(geojson);
  } catch (error) {
    console.error("Lỗi lấy lộ trình:", error);
    res.status(500).json({ error: "Lỗi kết nối cơ sở dữ liệu" });
  }
});

// 3. API: Thêm mới một trạm xe buýt từ bản đồ (Point)
app.post("/api/v1/stops", async (req, res) => {
  const { stop_id, stop_name, address, longitude, latitude } = req.body;
  if (!stop_id || !stop_name || longitude === undefined || latitude === undefined) {
    return res.status(400).json({ error: "Thiếu tham số dữ liệu không gian bắt buộc" });
  }

  try {
    const query = `
      INSERT INTO bus_stops (stop_id, stop_name, address, geom)
      VALUES (?, ?, ?, ST_GeomFromText(?, 4326, 'axis-order=long-lat'))
    `;
    const wktPoint = `POINT(${longitude} ${latitude})`;
    await dbPool.query(query, [stop_id, stop_name, address || "", wktPoint]);
    res.status(201).json({ message: "Thêm trạm thành công", stop_id });
  } catch (error) {
    console.error("Lỗi chèn trạm:", error);
    res.status(500).json({ error: "Không thể lưu trạm vào CSDL" });
  }
});

// --------------------------------------------------------------------
// WEBSOCKET BROADCAST HUB (REALTIME)
// --------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log(`[Socket] Client kết nối thành công: ${socket.id}`);

  // Tiếp nhận gói GPS phát từ simulator
  socket.on("gps_ping", async (gpsData) => {
    // 1. Chuyển tiếp tức thời xuống toàn bộ Map Client đang mở
    io.emit("fleet_location_update", gpsData);

    // 2. Ghi vết lịch sử vào bảng vehicle_tracking_logs (Chạy bất đồng bộ)
    try {
      const wkt = `POINT(${gpsData.longitude} ${gpsData.latitude})`;
      await dbPool.query(
        `INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom)
         VALUES (?, ?, ?, ST_GeomFromText(?, 4326, 'axis-order=long-lat'))`,
        [gpsData.vehicle_id, gpsData.speed_kmh || 0, gpsData.heading || 0, wkt]
      );
    } catch (err) {
      console.error("[Tracking DB Error]:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] Client ngắt kết nối: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`>>> Máy chủ Web GIS đang hoạt động tại: http://localhost:${PORT}`);
});
```

---

## 4. Bộ giả lập xe buýt: `backend/simulator.js`

```javascript
const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");

// Chuỗi đỉnh uốn của tuyến đường số hóa khu vực ĐHQG
const routeWaypoints = [
  [106.795000, 10.863000],
  [106.796500, 10.864500],
  [106.798000, 10.866000],
  [106.799000, 10.868000],
  [106.800000, 10.870000],
  [106.801000, 10.870300],
  [106.801960, 10.870525],
  [106.802500, 10.874000],
  [106.803300, 10.877800],
  [106.804500, 10.873000],
  [106.805500, 10.868500]
];

// Cấu hình 2 xe buýt chạy lệch pha nhau
const activeBuses = [
  { vehicle_id: "BUS_51B_01", plate_number: "51B-123.45", step: 0, speed: 32 },
  { vehicle_id: "BUS_51B_02", plate_number: "51B-678.90", step: 4, speed: 28 }
];

socket.on("connect", () => {
  console.log(">>> Đã kết nối tới Socket Hub. Bắt đầu phát luồng tín hiệu GPS xe buýt...");

  // Định kỳ phát vị trí mỗi 2 giây
  setInterval(() => {
    activeBuses.forEach((bus) => {
      const currentCoord = routeWaypoints[bus.step];
      const nextCoord = routeWaypoints[(bus.step + 1) % routeWaypoints.length];

      // Tính góc quay (Heading)
      const dLon = nextCoord[0] - currentCoord[0];
      const dLat = nextCoord[1] - currentCoord[1];
      const heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;

      const packet = {
        vehicle_id: bus.vehicle_id,
        plate_number: bus.plate_number,
        route_id: "BUS_01",
        longitude: currentCoord[0],
        latitude: currentCoord[1],
        speed_kmh: bus.speed + Math.floor(Math.random() * 5 - 2),
        heading: parseFloat(heading.toFixed(1)),
        timestamp: new Date().toISOString()
      };

      socket.emit("gps_ping", packet);
      console.log(`[GPS Stream] ${bus.plate_number} -> [${packet.longitude}, ${packet.latitude}] | ${packet.speed_kmh} km/h`);

      // Dịch chuyển đến điểm tiếp theo
      bus.step = (bus.step + 1) % routeWaypoints.length;
    });
  }, 2000);
});
```

---

## 5. Màn hình giám sát chính: `frontend/index.html`

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>Giám sát Hành trình Xe Buýt 2D - ArcGIS Maps SDK</title>

  <style>
    html, body, #viewDiv {
      padding: 0;
      margin: 0;
      height: 100%;
      width: 100%;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }

    #dashboard {
      position: absolute;
      top: 15px;
      right: 15px;
      background: rgba(255, 255, 255, 0.95);
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
      z-index: 99;
      min-width: 260px;
    }

    #dashboard h4 {
      margin: 0 0 10px 0;
      color: #0079c1;
      font-size: 16px;
    }

    .info-row {
      margin-bottom: 6px;
      font-size: 13px;
    }

    .badge-status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      background: #28a745;
      color: white;
      font-weight: bold;
      font-size: 11px;
    }
  </style>

  <!-- ArcGIS Maps SDK for JavaScript 4.29 & Socket.io CDN -->
  <link rel="stylesheet" href="[https://js.arcgis.com/4.29/esri/themes/light/main.css](https://js.arcgis.com/4.29/esri/themes/light/main.css)" />
  <script src="[https://js.arcgis.com/4.29/](https://js.arcgis.com/4.29/)"></script>
  <script src="[https://cdn.socket.io/4.7.5/socket.io.min.js](https://cdn.socket.io/4.7.5/socket.io.min.js)"></script>
</head>
<body>

  <div id="viewDiv"></div>

  <div id="dashboard">
    <h4>ĐIỀU HÀNH ĐỘI XE REALTIME</h4>
    <div class="info-row"><b>Tuyến:</b> Tuyến 08 (ĐHQG - Bến Thành)</div>
    <div class="info-row"><b>Biển số:</b> <span id="busPlate">Đang chờ tín hiệu...</span></div>
    <div class="info-row"><b>Vận tốc:</b> <span id="busSpeed">0</span> km/h</div>
    <div class="info-row"><b>Tọa độ:</b> <span id="busCoord">[---, ---]</span></div>
    <div class="info-row"><b>Trạng thái:</b> <span class="badge-status" id="busStatus">KẾT NỐI</span></div>
  </div>

  <script>
    require([
      "esri/Map",
      "esri/views/MapView",
      "esri/Graphic",
      "esri/layers/GraphicsLayer"
    ], function(Map, MapView, Graphic, GraphicsLayer) {

      // 1. Khởi tạo bản đồ 2D phẳng
      const map = new Map({ basemap: "osm" });
      const view = new MapView({
        container: "viewDiv",
        map: map,
        center: [106.80196, 10.87052], // ĐHQG TP.HCM
        zoom: 15
      });

      // 2. Tạo các Layer riêng biệt để quản lý lớp dữ liệu
      const routeLayer = new GraphicsLayer();
      const stopsLayer = new GraphicsLayer();
      const fleetLayer = new GraphicsLayer();
      map.addMany([routeLayer, stopsLayer, fleetLayer]);

      // 3. Tải lộ trình tim đường (Polyline)
      fetch("http://localhost:3000/api/v1/routes/BUS_01/path")
        .then(res => res.json())
        .then(geojson => {
          const polylineGraphic = new Graphic({
            geometry: {
              type: "polyline",
              paths: geojson.geometry.coordinates
            },
            symbol: {
              type: "simple-line",
              color: [0, 122, 255, 0.85],
              width: 5
            }
          });
          routeLayer.add(polylineGraphic);
        })
        .catch(err => console.warn("Dùng dữ liệu fallback tim đường:", err));

      // 4. Tải danh mục trạm dừng (Point)
      fetch("http://localhost:3000/api/v1/stops")
        .then(res => res.json())
        .then(geojson => {
          geojson.features.forEach(f => {
            const stopMarker = new Graphic({
              geometry: {
                type: "point",
                longitude: f.geometry.coordinates[0],
                latitude: f.geometry.coordinates[1]
              },
              symbol: {
                type: "simple-marker",
                color: [0, 150, 136],
                size: "10px",
                outline: { color: [255, 255, 255], width: 1.5 }
              },
              attributes: f.properties,
              popupTemplate: {
                title: "Trạm: {stop_name}",
                content: "<b>Mã trạm:</b> {stop_id}<br><b>Địa chỉ:</b> {address}"
              }
            });
            stopsLayer.add(stopMarker);
          });
        })
        .catch(err => console.warn("Lỗi API stops:", err));

      // 5. Quản lý các Graphic biểu diễn xe buýt di chuyển
      const busGraphicsMap = new Map();

      // Kết nối nhận luồng GPS từ Socket Server
      const socket = io("http://localhost:3000");

      socket.on("fleet_location_update", function(data) {
        // Cập nhật thông số lên Dashboard
        document.getElementById("busPlate").innerText = data.plate_number;
        document.getElementById("busSpeed").innerText = data.speed_kmh;
        document.getElementById("busCoord").innerText = `[${data.longitude.toFixed(4)}, ${data.latitude.toFixed(4)}]`;

        if (busGraphicsMap.has(data.vehicle_id)) {
          // Di chuyển đối tượng Graphic đã có
          const existingGraphic = busGraphicsMap.get(data.vehicle_id);
          existingGraphic.geometry = {
            type: "point",
            longitude: data.longitude,
            latitude: data.latitude
          };
          existingGraphic.attributes.speed = data.speed_kmh;
        } else {
          // Thêm mới xe buýt vào bản đồ
          const busGraphic = new Graphic({
            geometry: {
              type: "point",
              longitude: data.longitude,
              latitude: data.latitude
            },
            symbol: {
              type: "simple-marker",
              color: [255, 59, 48], // Đỏ nổi bật
              size: "14px",
              outline: { color: [255, 255, 255], width: 2 }
            },
            attributes: {
              plate: data.plate_number,
              speed: data.speed_kmh
            },
            popupTemplate: {
              title: "Xe Buýt: {plate}",
              content: "<b>Vận tốc:</b> {speed} km/h<br><b>Trạng thái:</b> Đang vận hành"
            }
          });

          fleetLayer.add(busGraphic);
          busGraphicsMap.set(data.vehicle_id, busGraphic);
        }
      });
    });
  </script>
</body>
</html>
```

---

## 6. Công cụ thu thập tọa độ: `tools/coordinate_picker.html`

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Công cụ lấy tọa độ - Coordinate Picker</title>
  <style>
    html, body, #viewDiv { padding: 0; margin: 0; height: 100%; width: 100%; font-family: Arial; }
    #toolPanel {
      position: absolute; top: 15px; right: 15px;
      background: rgba(255, 255, 255, 0.95); padding: 15px;
      border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 99; width: 320px;
    }
    textarea { width: 100%; height: 90px; margin-top: 8px; font-family: monospace; }
    .btn { padding: 6px 12px; margin-top: 6px; background-color: #0079c1; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .btn-clear { background-color: #d9534f; }
  </style>
  <link rel="stylesheet" href="[https://js.arcgis.com/4.29/esri/themes/light/main.css](https://js.arcgis.com/4.29/esri/themes/light/main.css)" />
  <script src="[https://js.arcgis.com/4.29/](https://js.arcgis.com/4.29/)"></script>
</head>
<body>
  <div id="viewDiv"></div>
  <div id="toolPanel">
    <h4 style="margin: 0; color: #0079c1;">Bộ Thu Thập Tọa Độ (GIS)</h4>
    <div><b>Điểm vừa click:</b> <span id="currentPoint" style="color: red;">Chưa chọn</span></div>
    <textarea id="coordOutput" placeholder="Bấm click trên bản đồ để tích lũy tọa độ..."></textarea>
    <div>
      <button class="btn" onclick="copyCoordinates()">Sao chép (Copy)</button>
      <button class="btn btn-clear" onclick="clearData()">Xóa hết</button>
    </div>
  </div>

  <script>
    let collectedPoints = [];
    let graphicsLayer;

    require(["esri/Map", "esri/views/MapView", "esri/Graphic", "esri/layers/GraphicsLayer"], 
    function(Map, MapView, Graphic, GraphicsLayer) {
      const map = new Map({ basemap: "osm" });
      const view = new MapView({
        container: "viewDiv",
        map: map,
        center: [106.80196, 10.87052],
        zoom: 16
      });

      graphicsLayer = new GraphicsLayer();
      map.add(graphicsLayer);
      view.popup.autoOpenEnabled = false;

      view.on("click", function(event) {
        const lon = parseFloat(event.mapPoint.longitude.toFixed(6));
        const lat = parseFloat(event.mapPoint.latitude.toFixed(6));

        collectedPoints.push([lon, lat]);
        document.getElementById("currentPoint").innerText = `[${lon}, ${lat}]`;
        document.getElementById("coordOutput").value = JSON.stringify(collectedPoints);

        const pointGraphic = new Graphic({
          geometry: { type: "point", longitude: lon, latitude: lat },
          symbol: { type: "simple-marker", color: [226, 119, 40], size: "8px", outline: { color: [255, 255, 255], width: 1.5 } }
        });
        graphicsLayer.add(pointGraphic);
      });
    });

    function copyCoordinates() {
      const textarea = document.getElementById("coordOutput");
      textarea.select();
      navigator.clipboard.writeText(textarea.value);
      alert("Đã sao chép mảng tọa độ vào Clipboard!");
    }

    function clearData() {
      collectedPoints = [];
      document.getElementById("coordOutput").value = "";
      document.getElementById("currentPoint").innerText = "Chưa chọn";
      if (graphicsLayer) graphicsLayer.removeAll();
    }
  </script>
</body>
</html>
```

---

## 7. Công cụ chuyển đổi tọa độ Google Maps: `tools/google_maps_importer.html`

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Nhập tọa độ Google Maps sang ArcGIS</title>
  <style>
    html, body, #viewDiv { padding: 0; margin: 0; height: 100%; width: 100%; font-family: Arial; }
    #panel {
      position: absolute; top: 15px; right: 15px;
      background: white; padding: 15px; border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3); z-index: 99; width: 320px;
    }
    input, textarea { width: 100%; padding: 6px; margin: 4px 0 8px 0; box-sizing: border-box; }
    button { padding: 6px 12px; background: #0079c1; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .btn-green { background: #28a745; }
  </style>
  <link rel="stylesheet" href="[https://js.arcgis.com/4.29/esri/themes/light/main.css](https://js.arcgis.com/4.29/esri/themes/light/main.css)" />
  <script src="[https://js.arcgis.com/4.29/](https://js.arcgis.com/4.29/)"></script>
</head>
<body>
  <div id="viewDiv"></div>
  <div id="panel">
    <h4 style="margin: 0 0 8px 0; color: #0079c1;">Chuyển đổi Tọa độ Google Maps</h4>
    <label><b>1. Dán trạm (Lat, Lon):</b></label>
    <input type="text" id="stopCoords" placeholder="VD: 10.8778, 106.8033" />
    <button onclick="addStop()">Vẽ Trạm lên bản đồ</button>

    <hr style="margin: 12px 0;">

    <label><b>2. Dán lộ trình tim đường:</b></label>
    <textarea id="routeCoords" rows="3" placeholder="10.8705, 106.8019&#10;10.8778, 106.8033"></textarea>
    <button class="btn-green" onclick="drawRoute()">Vẽ Tuyến Đường</button>
  </div>

  <script>
    let myView, routesLayer, stopsLayer, GraphicClass;

    require(["esri/Map", "esri/views/MapView", "esri/Graphic", "esri/layers/GraphicsLayer"],
    function(Map, MapView, Graphic, GraphicsLayer) {
      GraphicClass = Graphic;
      const map = new Map({ basemap: "osm" });
      myView = new MapView({ container: "viewDiv", map: map, center: [106.80196, 10.87052], zoom: 15 });

      routesLayer = new GraphicsLayer();
      stopsLayer = new GraphicsLayer();
      map.addMany([routesLayer, stopsLayer]);
    });

    function parseCoord(text) {
      if (!text.includes(",")) return null;
      const p = text.split(",");
      const lat = parseFloat(p[0].trim());
      const lon = parseFloat(p[1].trim());
      return (!isNaN(lat) && !isNaN(lon)) ? [lon, lat] : null; // Đảo thành [Lon, Lat]
    }

    function addStop() {
      const coord = parseCoord(document.getElementById("stopCoords").value);
      if (!coord) return alert("Sai định dạng tọa độ!");
      stopsLayer.add(new GraphicClass({
        geometry: { type: "point", longitude: coord[0], latitude: coord[1] },
        symbol: { type: "simple-marker", color: [226, 119, 40], size: "12px", outline: { color: [255, 255, 255], width: 2 } }
      }));
      myView.goTo({ center: coord, zoom: 16 });
    }

    function drawRoute() {
      const lines = document.getElementById("routeCoords").value.trim().split("\n");
      const paths = [];
      lines.forEach(l => {
        const c = parseCoord(l);
        if (c) paths.push(c);
      });
      if (paths.length < 2) return alert("Cần tối thiểu 2 điểm!");
      routesLayer.removeAll();
      routesLayer.add(new GraphicClass({
        geometry: { type: "polyline", paths: paths },
        symbol: { type: "simple-line", color: [0, 122, 255], width: 4 }
      }));
    }
  </script>
</body>
</html>
```