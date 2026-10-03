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
        │ MariaDB 10.4  │      │ backend/simulator.js│
        │  (SRID 4326)   │◄─────┤ Nội suy Haversine   │
        │  8 bảng        │ đọc  │ phát GPS mỗi 1s     │
        └───────▲───────┘route  └────────────────────┘
                │ npm run db:import ▲ npm run db:export
        ┌───────┴──────────────────────┐
        │ database/busdata.sql         │
        │ 178 tuyến · 5.898 trạm TP.HCM │
        └──────────────────────────────┘
```

---

## 2. Ngăn xếp công nghệ

| Lớp | Công nghệ | Ghi chú |
|-----|-----------|---------|
| Client | ArcGIS Maps SDK for JS **4.29**, Socket.io client 4.7.5 | Nạp qua CDN, không có bước build |
| Backend | Node.js, Express 4.19, Socket.io 4.7.5 | `server.js` |
| Auth | jsonwebtoken 9, bcryptjs 3 | JWT hết hạn 24h |
| DB driver | mysql2 3.9 (promise pool, `connectionLimit: 10`) | `multipleStatements: true` |
| CSDL | MariaDB 10.4 (Docker `bus-gis-mariadb`), `schema.sql` tương thích MySQL 8.x | Kiểu `POINT`, `LINESTRING`, SRID 4326 |
| Simulator | socket.io-client, mysql2 | Tiến trình Node riêng |

Điểm cấu hình: `backend/.env` (`PORT`, `DB_*`, `JWT_SECRET`, `SOCKET_URL`). Có giá trị fallback hard-code trong code nếu thiếu `.env`.

---

## 3. Kiến trúc Backend (`server.js`)

Một tiến trình phục vụ đồng thời HTTP (Express) và WebSocket (Socket.io) trên cùng cổng (mặc định `3000`).

### 3.1 Khởi tạo tự động (`initDatabase`)
- Tạo database nếu chưa có, nạp `database/schema.sql` khi bảng `users` vắng mặt. `schema.sql` chỉ tạo bảng và tài khoản người dùng; dữ liệu tuyến/trạm/lộ trình nạp riêng bằng `npm run db:import` (xem mục 7).
- Tự seed 2 tài khoản VIEWER mặc định (`khach`, `viewer`) nếu thiếu.

### 3.2 Middleware xác thực & phân quyền
- `authenticateToken` — đọc `Authorization: Bearer <token>`, verify JWT → gắn `req.user`. Thiếu token → 401, sai/hết hạn → 403.
- `requireAdmin` — chặn nếu `req.user.role !== "ADMIN"` → 403.
- **Chế độ test local:** chạy backend với `DISABLE_AUTH=true` thì `authenticateToken` bỏ qua JWT và gắn sẵn user admin (`user_id 1`) cho mọi request; frontend tự vào thẳng không cần đăng nhập. Server in cảnh báo khi bật. Không dùng khi triển khai.

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
| 3 | Routes | `GET/POST/PUT/DELETE /routes` (GET kèm đếm trạm & lộ trình, sắp xếp tự nhiên theo số tuyến: `13` trước `100`) |
| 4 | Route paths | `GET/POST /routes/:id/path` — trả/lưu GeoJSON LineString |
| 5 | Stops | `GET/POST/PUT/DELETE /stops` — GeoJSON FeatureCollection. `GET` nhận `bbox=minLon,minLat,maxLon,maxLat`, `q` (tìm mã/tên/địa chỉ), `page` + `limit` (tối đa 1000); trả thêm `total`, `page`, `limit`. Gán/bỏ gán trạm vào tuyến qua `/routes/:id/stops` (bỏ gán truyền `stop_order` để chỉ xóa một lượt ghé trên tuyến vòng) |
| 6 | Vehicles | `GET/POST/PUT/DELETE /vehicles` |
| 7 | Schedules | `GET/POST/PUT/DELETE /schedules` (lọc theo route/vehicle/direction) |
| 8 | Dashboard | `GET /admin/stats` |
| 9 | Import/Export | `POST /import/json`, `GET /export/json` |
| 10 | WebSocket Hub | sự kiện `gps_ping` → `fleet_location_update` |

### 3.4 Xử lý không gian (GIS)
- Ghi: mảng tọa độ → chuỗi WKT (`POINT(...)`, `LINESTRING(...)`) → `ST_GeomFromText(?, 4326)`.
- Đọc: `ST_AsGeoJSON(geom)` → parse → trả GeoJSON chuẩn cho ArcGIS.
- Quy ước trục: **long–lat** (`[lon, lat]`).
- Lọc theo khung nhìn: `MBRContains(ST_GeomFromText(polygon), geom)` dùng Spatial Index. Polygon truy vấn không gắn SRID vì MariaDB 10.4 báo lỗi 1207 khi kết hợp SRID 4326 với spatial index.

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
| `js/common/` | `config.js` (`SERVER_URL`, `API_BASE`, khóa token, tâm bản đồ TP.HCM, ngưỡng zoom & giới hạn tải trạm), `api.js` (`postJson`, `debounce`, `routeOptionsHtml`) |
| `js/map/` | Trang giám sát: `toast`, `auth`, `map` (ArcGIS), `routes` (tuyến/trạm), `realtime` (Socket.io + nội suy), `main` |
| `js/admin/` | Admin Portal: `api` (header JWT, `saveResource`, cache tuyến/xe), `ui` (modal, tab), `auth`, `dashboard`, `routes`, `stops`, `vehicles`, `schedules`, `users`, `import`, `main` |

### `frontend/index.html` — Giám sát real-time
- ArcGIS 2D map, tâm mặc định trung tâm TP.HCM; tải tuyến/trạm/lộ trình qua REST (GeoJSON).
- Chọn một tuyến: tải lộ trình + danh sách trạm theo chiều. Chế độ "Tất cả các tuyến": **không** tải toàn bộ ~6.000 trạm; chỉ tải trạm trong khung nhìn (`bbox`, tối đa 500) khi zoom ≥ 15, và tự nạp lại mỗi khi dừng kéo/zoom. Ô tìm kiếm ở chế độ này gọi server (`q`, tối đa 50 kết quả).
- Popup trạm hiện mã trạm, loại trạm, trạng thái; trạm không còn khai thác vẽ màu xám.
- Kết nối Socket.io, nghe `fleet_location_update` → di chuyển icon xe mượt, tính trạm kế tiếp.
- Popup bám theo xe khi click (theo lịch sử commit).

### `frontend/admin.html` — Admin Portal
- Đăng nhập JWT (lưu client, gửi qua `Authorization` header).
- CRUD routes/stops/vehicles/schedules/users, dashboard stats, import/export JSON.
- Bảng "Tất cả các trạm" phân trang phía server (50 trạm/trang) kèm ô tìm kiếm; modal "Gán trạm vào tuyến" lọc trạm qua ô tìm kiếm thay vì nạp toàn bộ danh sách.
- Ẩn/khóa chức năng theo `currentUser.role` (kiểm tra `role !== "ADMIN"`).

### `tools/`
- `get_coords_1.html` — trích xuất lộ trình & trạm (nguồn dữ liệu import).
- `google_maps_importer.html` — chuyển & đảo tọa độ Google Maps → chuẩn long-lat.

---

## 7. Mô hình dữ liệu (`schema.sql`)

8 bảng, InnoDB, charset `utf8mb4`, hệ quy chiếu WGS84 (SRID 4326).

| Bảng | Vai trò | Không gian |
|------|---------|-----------|
| `users` | Tài khoản, role ENUM(ADMIN/MANAGER/VIEWER), `password_hash` bcrypt | — |
| `bus_routes` | Tuyến (PK `route_id` VARCHAR), số hiệu, tên, cự ly, headway, loại hình, màu, giờ hoạt động | — |
| `route_paths` | Lộ trình tim đường theo chiều | `LINESTRING` + SPATIAL INDEX |
| `bus_stops` | Trạm dừng, mã trạm, loại trạm, trạng thái khai thác | `POINT` + SPATIAL INDEX |
| `route_stops` | Quan hệ M–N tuyến↔trạm + thứ tự, PK `(route_id, direction, stop_order)` — hỗ trợ tuyến vòng | — |
| `vehicles` | Đội xe, biển số UNIQUE, tài xế, trạng thái | — |
| `schedules` | Phân công xe↔tuyến↔giờ xuất bến↔chiều | — |
| `vehicle_tracking_logs` | Vết GPS lịch sử (spatio-temporal) | `POINT` + INDEX(vehicle_id, recorded_at) |

- `direction`: `1 = Đi`, `2 = Về`.
- Toàn bộ FK dùng `ON DELETE CASCADE` (xóa tuyến/xe kéo theo dữ liệu liên quan).
- Dữ liệu: mạng lưới xe buýt thực tế TP.HCM trong `database/busdata.sql` (178 tuyến, 5.898 trạm, 332 lộ trình, 13.772 liên kết trạm–tuyến), nạp bằng `npm run db:import`, ghi ngược từ CSDL bằng `npm run db:export` sau khi sửa trên `path-editor.html`. Chi tiết quy tắc chuyển đổi: `docs/DATABASE_SPECIFICATION.md` mục 1.1.
- CSDL cũ (trước khi tích hợp busdata) cần chạy `database/migrations/001_busdata_schema.sql` trước khi nạp dữ liệu.

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
Admin đăng nhập → JWT → CRUD/import qua REST → ghi CSDL → `simulator` tự nạp lại sau ≤30s → xe mới xuất hiện trên bản đồ.

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
| Simulator tự sinh 2–3 xe ảo cho mọi lộ trình không có lịch | `simulator.js` | Với 332 lộ trình thực tế: ~900 xe, ~900 INSERT/giây; `vehicle_id` ảo không có trong `vehicles` → FK fail. Chưa xử lý (Milestone 3) |
| Panel "Điều hành đội xe realtime" hiển thị nội dung mẫu cứng khi chưa có xe | `frontend/index.html` | Gây hiểu nhầm (Tuyến 08, 51B-123.45...) |
| Cờ `DISABLE_AUTH=true` bỏ qua toàn bộ xác thực | `server.js` | Chỉ dùng test local |

---

## 10. Vận hành

```bash
# 1. CSDL MariaDB (Docker) — bảng & tài khoản tự tạo khi start backend lần đầu
docker start bus-gis-mariadb
# 2. Backend
cd backend && npm start        # http://localhost:3000  (DISABLE_AUTH=true npm start để test không cần đăng nhập)
# 3. Nạp dữ liệu xe buýt TP.HCM từ database/busdata.sql (thay 4 bảng tuyến/trạm/lộ trình/trạm-tuyến)
cd backend && npm run db:import
#    Sau khi sửa trên path-editor.html: ghi CSDL ngược vào file rồi commit
cd backend && npm run db:export
# 4. Simulator (terminal khác) — lưu ý rủi ro tải ở mục 9
cd backend && npm run simulate
# 5. Phục vụ frontend tĩnh
python3 -m http.server 8080 --directory frontend   # http://localhost:8080 , /admin.html
```

Nâng cấp CSDL cũ (trước khi tích hợp busdata): `docker exec -i bus-gis-mariadb mysql -uroot bus_management_db < database/migrations/001_busdata_schema.sql` rồi chạy bước 3.

Tài khoản mặc định: `admin/admin123` (ADMIN), `manager/manager123` (MANAGER), `khach/khach123` & `viewer/viewer123` (VIEWER).
