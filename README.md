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
│   │   ├── middleware/auth.js      # authenticateToken (JWT), requireAdmin, requireRole, requireStaff
│   │   ├── modules/                # Mỗi feature: <tên>.routes.js + <tên>.controller.js (+ .service.js)
│   │   │   ├── auth/  driver/  users/  bus-routes/  paths/  stops/  trip-plan/
│   │   │   └── vehicles/  schedules/  admin-stats/  import-export/
│   │   └── sockets/                # index.js, viewer.socket.js ("/" theo room: trip/vehicle/staff/route), device.socket.js + device.auth.js ("/device" tài xế), trip-registry.js, trip-list.js, eta.js, route-geometry.js, gps.validate.js, tracking-log.js
│   └── scripts/                    # db:import / db:export busdata.sql, db:seed-drivers (tài xế demo)
├── docs/
│   ├── USE_CASES.md                # Đặc tả use case theo tác nhân
│   ├── DATABASE_SPECIFICATION.md   # Đặc tả CSDL không gian: ERD, từ điển dữ liệu, chỉ mục, DDL
│   ├── DATA_FLOW.md                # Luồng dữ liệu: kho dữ liệu, DFD, sequence realtime, ma trận CRUD
│   └── NODEJS_VS_LARAVEL_ANALYSIS.md # Phân tích so sánh công nghệ Backend (Node.js vs Laravel)
├── frontend/
│   ├── index.html                  # Shell bản đồ giám sát 2D Realtime (ArcGIS JS SDK v4.29)
│   ├── admin.html                  # Shell trang Quản trị Admin Portal (Auth, CRUD & JSON Importer)
│   ├── driver.html                 # Trang tài xế (mobile): đăng nhập, chọn chuyến, bản đồ, phát GPS điện thoại
│   ├── assets/css/                 # map.css, admin.css, driver.css
│   └── src/                        # ES modules, không cần build (phải mở qua HTTP, không chạy file://)
│       ├── core/                   # config (API_BASE), http (request + ApiError), session (token), actions (data-action), dom, toast, modal, arcgis
│       ├── modules/<tên>/<tên>.service.js # Gọi API & xử lý response theo module backend:
│       │                           #   auth, users, bus-routes, paths, stops, trip-plan, vehicles, schedules,
│       │                           #   admin-stats, import-export, driver, realtime (Socket.io viewer "/" + device "/device")
│       └── views/
│           ├── map/                # map.view.js (entry), map.state.js, sections/*.html,
│           │                       #   features/: base-map, staff-auth, route-browser, fleet-tracking, geolocation, trip-finder/
│           ├── admin/              # admin.view.js (entry), admin.state.js, sections/{tabs,modals}/*.html,
│           │                       #   features/: auth, navigation, dashboard, routes, stops, vehicles, schedules, json-hub, users
│           └── driver/             # driver.view.js (entry), driver.state.js, sections/{login,trip-select,drive-panel}.html,
│                                   #   features/: screens, driver-auth, trip-select, drive-map, phone-gps, next-stop
├── simulator/                      # (Tùy chọn, công cụ demo) Tài xế ảo phát GPS — độc lập, xóa khi triển khai thật
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
* **Tài xế (DRIVER):** `driver01` … `driver20` / `driver123` (sau khi chạy `npm run db:seed-drivers`)

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
> Server sẽ lắng nghe tại: `http://localhost:3000` — phục vụ cả API lẫn giao diện tĩnh (`frontend/`, `tools/`), không cần Apache/XAMPP.

### 3. Tài khoản tài xế & nguồn GPS

GPS chỉ được phát bởi **tài xế đã đăng nhập** (namespace Socket.io `/device`, JWT role `DRIVER`). Bản đồ không phát được GPS; khách chỉ nhận vị trí của chuyến đã chọn.

```bash
cd backend && npm run db:seed-drivers -- --count 20   # driver01..driver20 / mật khẩu driver123, xe DRV_01..DRV_20, 4 tài xế/tuyến → 5 tuyến
```

Mỗi tài xế có 17 chuyến/ngày (05:00 + slot×15' + k×60'), đổi chiều sau mỗi chuyến: mỗi tuyến có chuyến 15 phút một lần, mỗi chiều trung bình 30 phút một lần. Simulator chọn chuyến theo giờ Việt Nam và tự đổi chuyến khi tới giờ xuất bến.

**Bản đồ công khai:** khách chưa chọn tuyến thì không thấy xe nào. Chọn điểm đến → bấm thẻ tuyến → danh sách chuyến đang chạy/sắp tới kèm ETA tới trạm lên → bấm 1 chuyến để thấy đúng xe đó. Nhân viên đăng nhập thấy toàn đội xe.

Backend tự bổ sung vai trò `DRIVER` và cột `vehicles.driver_user_id` khi khởi động (idempotent), nên DB production không cần chạy seed demo chỉ để migrate.

`db:import` không đụng `users`/`vehicles`. Nếu import làm thay đổi danh sách tuyến, chạy lại seed để tài xế có lịch trình.

**Trang tài xế:** `http://localhost:3000/frontend/driver.html`. Đăng nhập → chọn chuyến → **Bắt đầu chuyến** để phát GPS điện thoại.
Trình duyệt chỉ cho đọc GPS trên HTTPS hoặc `localhost`:
- Test trên laptop: mở bằng `localhost`, giả lập vị trí bằng DevTools → Sensors.
- Test trên điện thoại thật: mở tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000` hoặc `ngrok http 3000`).

**Simulator (tùy chọn):** tài xế ảo đăng nhập và phát GPS giống điện thoại. Xem [simulator/README.md](simulator/README.md).

```bash
cd simulator && npm install && npm start -- --count 10
```

### 4. Truy cập Hệ thống
* **Giao diện Bản đồ Giám sát Real-time:** `http://localhost:3000/` (chuyển tới `/frontend/index.html`)
* **Trang Quản trị Hệ thống (Admin Portal):** `http://localhost:3000/frontend/admin.html`
* **Trang Tài xế:** `http://localhost:3000/frontend/driver.html`
* **Công cụ lấy tọa độ:** `http://localhost:3000/tools/get_coords_1.html`
* **Công cụ chuyển tọa độ Google Maps:** `http://localhost:3000/tools/google_maps_importer.html`

