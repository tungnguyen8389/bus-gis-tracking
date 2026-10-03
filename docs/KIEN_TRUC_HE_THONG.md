# ĐẶC TẢ KIẾN TRÚC HỆ THỐNG
## Web GIS Giám sát & Quản trị Hành trình Xe buýt 2D (IE402)

> Tài liệu mô tả kiến trúc thực tế, suy ra trực tiếp từ mã nguồn (`backend/`, `frontend/`, `database/`).

---

## 1. Tổng quan

Hệ thống Web GIS giám sát vị trí xe buýt theo thời gian thực và quản trị dữ liệu tuyến/trạm/phương tiện. Kiến trúc **client–server 3 lớp**, kết hợp 2 kênh truyền:

- **REST/HTTP** — truy vấn & CRUD dữ liệu (GeoJSON).
- **WebSocket (Socket.io)** — đẩy vị trí GPS real-time xuống bản đồ.

Một tiến trình **Simulator** độc lập giả lập GPS xe buýt, thay cho thiết bị định vị vật lý.

### Sơ đồ thành phần

```
┌─────────────────────┐        ┌─────────────────────┐
│  index.html         │        │  admin.html         │
│  (Bản đồ giám sát)   │        │  (Admin Portal CRUD) │
│  ArcGIS SDK 4.29     │        │  ArcGIS + fetch      │
│  socket.io-client    │        │  JWT trong header    │
└─────────┬───────────┘        └──────────┬──────────┘
          │ WS: fleet_location_update      │ REST /api/v1/*
          │ REST /api/v1/*                 │ (Bearer JWT)
          ▼                                ▼
        ┌────────────────────────────────────────┐
        │        backend/server.js (Node.js)      │
        │  Express REST API  +  Socket.io Hub     │
        │  JWT auth · bcrypt · mysql2 pool        │
        └───────┬──────────────────────┬──────────┘
                │ SQL (mysql2)          │ WS: gps_ping
                ▼                       ▲
        ┌───────────────┐      ┌────────┴───────────┐
        │  MySQL 8 Spatial│      │ backend/simulator.js│
        │  (SRID 4326)   │◄─────┤ Nội suy Haversine   │
        │  7 bảng        │ đọc  │ phát GPS mỗi 1s     │
        └───────────────┘route  └────────────────────┘
```

---

## 2. Ngăn xếp công nghệ

| Lớp | Công nghệ | Ghi chú |
|-----|-----------|---------|
| Client | ArcGIS Maps SDK for JS **4.29**, Socket.io client 4.7.5 | Nạp qua CDN, không có bước build |
| Backend | Node.js, Express 4.19, Socket.io 4.7.5 | `server.js` |
| Auth | jsonwebtoken 9, bcryptjs 3 | JWT hết hạn 24h |
| DB driver | mysql2 3.9 (promise pool, `connectionLimit: 10`) | `multipleStatements: true` |
| CSDL | MySQL 8.x / MariaDB Spatial | Kiểu `POINT`, `LINESTRING`, SRID 4326 |
| Simulator | socket.io-client, mysql2 | Tiến trình Node riêng |

Điểm cấu hình: `backend/.env` (`PORT`, `DB_*`, `JWT_SECRET`, `SOCKET_URL`). Có giá trị fallback hard-code trong code nếu thiếu `.env`.

---

## 3. Kiến trúc Backend (`server.js`)

Một tiến trình phục vụ đồng thời HTTP (Express) và WebSocket (Socket.io) trên cùng cổng (mặc định `3000`).

### 3.1 Khởi tạo tự động (`initDatabase`)
- Tạo database nếu chưa có, nạp `database/schema.sql` khi bảng `users` vắng mặt.
- Tự seed 2 tài khoản VIEWER mặc định (`khach`, `viewer`) nếu thiếu.

### 3.2 Middleware xác thực & phân quyền
- `authenticateToken` — đọc `Authorization: Bearer <token>`, verify JWT → gắn `req.user`. Thiếu token → 401, sai/hết hạn → 403.
- `requireAdmin` — chặn nếu `req.user.role !== "ADMIN"` → 403.

**Phân quyền theo endpoint (thực tế trong code):**

| Nhóm route | Đọc (GET) | Ghi (POST/PUT/DELETE) |
|------------|-----------|------------------------|
| routes / stops / vehicles / schedules | Công khai (không auth) | `authenticateToken` |
| users | `authenticateToken` | `authenticateToken` + `requireAdmin` |
| import/export JSON | — | `authenticateToken` |
| admin/stats | `authenticateToken` | — |

> ⚠️ Lưu ý an ninh: nhiều thao tác ghi dữ liệu (routes/stops/vehicles/schedules) chỉ cần đăng nhập bất kỳ role — kể cả VIEWER — chứ không giới hạn MANAGER/ADMIN. Cần rà lại nếu VIEWER thực sự phải "chỉ xem".

### 3.3 Nhóm API (`/api/v1`)

| # | Nhóm | Endpoint chính |
|---|------|----------------|
| 1 | Auth | `POST login`, `POST register`, `GET me` |
| 2 | Users (ADMIN) | `GET/POST/PUT/DELETE /users` |
| 3 | Routes | `GET/POST/PUT/DELETE /routes` (GET kèm đếm trạm & lộ trình) |
| 4 | Route paths | `GET/POST /routes/:id/path` — trả/lưu GeoJSON LineString |
| 5 | Stops | `GET/POST/PUT/DELETE /stops` — GeoJSON FeatureCollection; gán trạm vào tuyến |
| 6 | Vehicles | `GET/POST/PUT/DELETE /vehicles` |
| 7 | Schedules | `GET/POST/PUT/DELETE /schedules` (lọc theo route/vehicle/direction) |
| 8 | Dashboard | `GET /admin/stats` |
| 9 | Import/Export | `POST /import/json`, `GET /export/json` |
| 10 | WebSocket Hub | sự kiện `gps_ping` → `fleet_location_update` |

### 3.4 Xử lý không gian (GIS)
- Ghi: mảng tọa độ → chuỗi WKT (`POINT(...)`, `LINESTRING(...)`) → `ST_GeomFromText(?, 4326)`.
- Đọc: `ST_AsGeoJSON(geom)` → parse → trả GeoJSON chuẩn cho ArcGIS.
- Quy ước trục: **long–lat** (`[lon, lat]`).

### 3.5 Import JSON đa định dạng (`/import/json`)
Tự nhận diện (`type: "auto"`) 6 loại: `full_package`, `route_path`, `stops`, `vehicles`, `routes`, `full_backup`. Chạy trong **transaction** (`beginTransaction`/`commit`/`rollback`). Tương thích output của công cụ `tools/get_coords_1.html`.

---

## 4. Kênh Real-time (WebSocket Hub)

```
simulator ──gps_ping──► server ──fleet_location_update──► tất cả map client (io.emit)
                           │
                           └─► INSERT vehicle_tracking_logs  (ghi vết, async, lỗi bỏ qua)
```

- Server **không xử lý logic**, chỉ broadcast tức thời + lưu lịch sử. Đúng vai trò "relay hub".
- Việc ghi log là best-effort: lỗi INSERT bị nuốt để không chặn luồng broadcast.

---

## 5. Bộ giả lập GPS (`simulator.js`)

Tiến trình Node độc lập (`npm run simulate`), là **nguồn phát vị trí** duy nhất.

1. `loadDataFromDatabase()` — đọc `route_paths` + `schedules`, tự làm lại mỗi **30s** (nhận dữ liệu mới từ Admin).
2. Tiền xử lý lộ trình: `processRouteGeometry` chia đoạn, tính khoảng cách **Haversine** và góc phương vị (heading).
3. Mỗi tuyến: dùng xe theo `schedules`; nếu không có → tự sinh 2–3 xe ảo để tuyến luôn có xe chạy.
4. Vòng phát mỗi **1s** (`TICK_INTERVAL_MS`): cập nhật quãng đường theo tốc độ (dao động sin nhẹ), **nội suy** tọa độ + heading, `emit("gps_ping")`.
5. Có `fallbackWaypoints` khi CSDL rỗng.

Gói `gps_ping`: `{ vehicle_id, plate_number, route_id, route_number, direction, longitude, latitude, speed_kmh, heading, timestamp }`.

---

## 6. Kiến trúc Frontend

Hai trang HTML tĩnh, không framework, không build; nạp thư viện qua CDN. CSS tách ra `frontend/css/`, JS tách ra `frontend/js/` dạng classic script (dùng chung global scope, nạp theo thứ tự trong HTML để các handler `onclick=` inline vẫn gọi được).

| Thư mục | Nội dung |
|---------|----------|
| `js/common/` | `config.js` (`SERVER_URL`, `API_BASE`, khóa token, tâm bản đồ), `api.js` (`postJson`, `routeOptionsHtml`) |
| `js/map/` | Trang giám sát: `toast`, `auth`, `map` (ArcGIS), `routes` (tuyến/trạm), `realtime` (Socket.io + nội suy), `main` |
| `js/admin/` | Admin Portal: `api` (header JWT, `saveResource`, cache tuyến/xe/trạm), `ui` (modal, tab), `auth`, `dashboard`, `routes`, `stops`, `vehicles`, `schedules`, `users`, `import`, `main` |

### `frontend/index.html` — Giám sát real-time
- ArcGIS 2D map; tải tuyến/trạm/lộ trình qua REST (GeoJSON).
- Kết nối Socket.io, nghe `fleet_location_update` → di chuyển icon xe mượt, tính trạm kế tiếp.
- Popup bám theo xe khi click (theo lịch sử commit).

### `frontend/admin.html` — Admin Portal
- Đăng nhập JWT (lưu client, gửi qua `Authorization` header).
- CRUD routes/stops/vehicles/schedules/users, dashboard stats, import/export JSON.
- Ẩn/khóa chức năng theo `currentUser.role` (kiểm tra `role !== "ADMIN"`).

### `tools/`
- `get_coords_1.html` — trích xuất lộ trình & trạm (nguồn dữ liệu import).
- `google_maps_importer.html` — chuyển & đảo tọa độ Google Maps → chuẩn long-lat.

---

## 7. Mô hình dữ liệu (`schema.sql`)

7 bảng, InnoDB, charset `utf8mb4`, hệ quy chiếu WGS84 (SRID 4326).

| Bảng | Vai trò | Không gian |
|------|---------|-----------|
| `users` | Tài khoản, role ENUM(ADMIN/MANAGER/VIEWER), `password_hash` bcrypt | — |
| `bus_routes` | Tuyến (PK `route_id` VARCHAR), số hiệu, tên, cự ly, headway | — |
| `route_paths` | Lộ trình tim đường theo chiều | `LINESTRING` + SPATIAL INDEX |
| `bus_stops` | Trạm dừng | `POINT` + SPATIAL INDEX |
| `route_stops` | Quan hệ M–N tuyến↔trạm + thứ tự (`stop_order`), theo chiều | — |
| `vehicles` | Đội xe, biển số UNIQUE, tài xế, trạng thái | — |
| `schedules` | Phân công xe↔tuyến↔giờ xuất bến↔chiều | — |
| `vehicle_tracking_logs` | Vết GPS lịch sử (spatio-temporal) | `POINT` + INDEX(vehicle_id, recorded_at) |

- `direction`: `1 = Đi`, `2 = Về`.
- Toàn bộ FK dùng `ON DELETE CASCADE` (xóa tuyến/xe kéo theo dữ liệu liên quan).
- Seed mẫu: khu ĐHQG TP.HCM (3 tuyến, 8 trạm, 4 xe).

### Quan hệ chính

```
users (độc lập)

bus_routes 1──N route_paths
bus_routes M──N bus_stops   (qua route_stops)
bus_routes 1──N schedules N──1 vehicles
vehicles   1──N vehicle_tracking_logs
```

---

## 8. Luồng nghiệp vụ chính

**A. Giám sát real-time**
`simulator` phát `gps_ping` (1s) → `server` broadcast `fleet_location_update` + log DB → `index.html` cập nhật vị trí xe trên bản đồ.

**B. Quản trị dữ liệu**
Admin đăng nhập → JWT → CRUD/import qua REST → ghi MySQL → `simulator` tự nạp lại sau ≤30s → xe mới xuất hiện trên bản đồ.

**C. Nhập lộ trình từ công cụ**
`tools/*.html` xuất JSON → Admin import (`/import/json`, auto-detect + transaction) → dữ liệu không gian vào `route_paths`/`bus_stops`.

---

## 9. Hạn chế & rủi ro đã ghi nhận

| Vấn đề | Vị trí | Ảnh hưởng |
|--------|--------|-----------|
| Ghi dữ liệu không giới hạn theo role | các route ghi routes/stops/vehicles/schedules | VIEWER đăng nhập vẫn có thể sửa dữ liệu |
| `JWT_SECRET` có fallback hard-code | `server.js:22` | Cần bắt buộc đặt qua `.env` khi triển khai |
| CORS `origin: "*"` | Express + Socket.io | Mở cho mọi nguồn — chỉ hợp môi trường học tập |
| `API_BASE`/socket URL hard-code `localhost:3000` | `frontend/js/common/config.js` (1 chỗ duy nhất) | Cần sửa khi deploy khác host |
| Lỗi ghi tracking log bị nuốt | Hub `gps_ping` | Mất vết âm thầm, khó chẩn đoán |

---

## 10. Vận hành

```bash
# 1. MySQL (XAMPP) chạy — DB tự tạo khi start backend
# 2. Backend
cd backend && npm start        # http://localhost:3000
# 3. Simulator (terminal khác)
cd backend && npm run simulate
# 4. Mở frontend/index.html & frontend/admin.html
```

Tài khoản mặc định: `admin/admin123` (ADMIN), `manager/manager123` (MANAGER), `khach/khach123` & `viewer/viewer123` (VIEWER).
