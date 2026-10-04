# HỆ THỐNG QUẢN LÝ VÀ GIÁM SÁT HÀNH TRÌNH XE BUÝT 2D (WEB GIS)

Dự án môn Hệ Thống Thông Tin Địa Lý (IE402) - Ứng dụng công nghệ ArcGIS Maps SDK for JavaScript, Node.js WebSocket Hub và MySQL 8.x Spatial.

---

## 📁 Cấu trúc thư mục

```
Bus_project/
├── database/
│   ├── schema.sql                  # Lược đồ CSDL MySQL 8.x / MariaDB Spatial + tài khoản & xe mẫu
│   └── busdata.sql                 # Dữ liệu xe buýt TP.HCM: 178 tuyến, 5898 trạm, 332 lộ trình (sinh bởi db:export)
├── backend/
│   ├── .env                        # File cấu hình môi trường (Port, DB connection)
│   ├── package.json                # Dependencies Express, Socket.io, MySQL2
│   ├── server.js                   # Entry: khởi tạo HTTP server, Socket.io, CSDL và listen
│   ├── src/
│   │   ├── app.js                  # Express app: middleware chung + mount router các module dưới /api/v1
│   │   ├── config/                 # env.js (biến môi trường), db.js (MySQL pool + initDatabase)
│   │   ├── middleware/auth.js      # authenticateToken (JWT), requireAdmin
│   │   ├── modules/                # Mỗi feature: <tên>.routes.js + <tên>.controller.js (+ .service.js)
│   │   │   ├── auth/  users/  bus-routes/  paths/  stops/  trip-plan/
│   │   │   └── vehicles/  schedules/  admin-stats/  import-export/
│   │   └── sockets/tracking.socket.js # Hub realtime: gps_ping → fleet_location_update + ghi log
│   ├── simulator.js                # Bộ phát GPS giả lập lộ trình xe buýt (đang tạm tắt)
│   └── scripts/                    # db:import / db:export busdata.sql
├── docs/
│   └── NODEJS_VS_LARAVEL_ANALYSIS.md # Phân tích so sánh công nghệ Backend (Node.js vs Laravel)
├── frontend/
│   ├── index.html                  # Shell bản đồ giám sát 2D Realtime (ArcGIS JS SDK v4.29)
│   ├── admin.html                  # Shell trang Quản trị Admin Portal (Auth, CRUD & JSON Importer)
│   ├── assets/css/                 # map.css, admin.css
│   └── src/                        # ES modules, không cần build (phải mở qua HTTP, không chạy file://)
│       ├── core/                   # config (API_BASE), http (request + ApiError), session (token), actions (data-action), dom, toast, modal, arcgis
│       ├── modules/<tên>/<tên>.service.js # Gọi API & xử lý response theo module backend:
│       │                           #   auth, users, bus-routes, paths, stops, trip-plan, vehicles, schedules,
│       │                           #   admin-stats, import-export, realtime (Socket.io)
│       └── views/
│           ├── map/                # map.view.js (entry), map.state.js, sections/*.html,
│           │                       #   features/: base-map, staff-auth, route-browser, fleet-tracking, geolocation, trip-finder/
│           └── admin/              # admin.view.js (entry), admin.state.js, sections/{tabs,modals}/*.html,
│                                   #   features/: auth, navigation, dashboard, routes, stops, vehicles, schedules, json-hub, users
├── tools/
│   ├── get_coords_1.html           # Công cụ trích xuất dữ liệu lộ trình & trạm nâng cao
│   └── google_maps_importer.html   # Công cụ import & đảo tọa độ Google Maps
├── AGENTS.md                       # Đặc tả toàn diện hệ thống cho AI Agent
├── GEMINI.md                       # Bản tóm tắt nhanh và quy ước cốt lõi cho AI
├── ARCHITECTURE_SPEC.md            # Tài liệu đặc tả kiến trúc gốc
└── README.md                       # Hướng dẫn cài đặt và chạy ứng dụng
```

---

## 🔐 Tài khoản Quản trị Mặc định

* **Quản trị viên (ADMIN):** `admin` / `admin123`
* **Người điều hành (MANAGER):** `manager` / `manager123`

---

## 🚀 Hướng dẫn khởi chạy

### 1. Khởi tạo Cơ sở dữ liệu (MySQL Spatial)
* Mở **XAMPP Control Panel** và Start module **MySQL**.
* Nạp dữ liệu xe buýt TP.HCM (tự tạo database `bus_management_db` và bảng nếu chưa có; CSDL cũ dùng schema demo ĐHQG sẽ được tự bổ sung cột / đổi khóa):
```bash
cd backend
npm install
npm run db:import
```
* Lệnh này thay toàn bộ dữ liệu 4 bảng `bus_routes`, `bus_stops`, `route_paths`, `route_stops` bằng nội dung `database/busdata.sql` (chạy trong 1 transaction). Tài khoản và xe được giữ nguyên; lịch trình trỏ tới tuyến không còn tồn tại (vd. demo `BUS_01`) bị xóa.
* Sau khi sửa tuyến / trạm / lộ trình trong CSDL, chạy `npm run db:export` để ghi lại vào `database/busdata.sql` rồi commit file đó.

### 2. Khởi động Backend Server
```bash
cd backend
npm start
```
> Server sẽ lắng nghe tại: `http://localhost:3000`

### 3. Bộ giả lập GPS xe buýt (đang tạm tắt)
`npm run simulate` hiện chỉ in thông báo và thoát: simulator chưa được tối ưu cho 332 lộ trình TP.HCM (tự sinh 2–3 xe mỗi lộ trình, phát 500ms/lần). Nếu vẫn cần chạy thử: `node simulator.js`.

### 4. Truy cập Hệ thống
* **Giao diện Bản đồ Giám sát Real-time:** `http://localhost/Bus_project/frontend/index.html`
* **Trang Quản trị Hệ thống (Admin Portal):** `http://localhost/Bus_project/frontend/admin.html`
* **Công cụ lấy tọa độ:** `tools/coordinate_picker.html`
* **Công cụ chuyển tọa độ Google Maps:** `tools/google_maps_importer.html`

