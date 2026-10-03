# HỆ THỐNG QUẢN LÝ VÀ GIÁM SÁT HÀNH TRÌNH XE BUÝT 2D (WEB GIS)

Dự án môn Hệ Thống Thông Tin Địa Lý (IE402) - Ứng dụng công nghệ ArcGIS Maps SDK for JavaScript, Node.js WebSocket Hub và MariaDB 10.4 Spatial, với dữ liệu mạng lưới xe buýt thực tế TP.HCM (178 tuyến, 5.898 trạm).

---

## 📁 Cấu trúc thư mục

```
Bus_project/
├── database/
│   ├── schema.sql                  # Lược đồ CSDL Spatial (tạo bảng + tài khoản người dùng)
│   ├── migrations/
│   │   └── 001_busdata_schema.sql  # Nâng cấp CSDL cũ để chứa dữ liệu busdata (MariaDB)
│   ├── busdata/                    # Dữ liệu xe buýt TP.HCM: routes.json, routes.geojson,
│   │                               # stops.geojson, route_stops.json
│   └── backup/                     # Bản sao lưu CSDL (không commit — chứa hash mật khẩu)
├── backend/
│   ├── .env                        # File cấu hình môi trường (Port, DB connection)
│   ├── package.json                # Dependencies Express, Socket.io, MySQL2
│   ├── server.js                   # REST API GeoJSON & Socket.io Realtime Hub
│   ├── simulator.js                # Bộ phát GPS giả lập lộ trình xe buýt
│   └── scripts/
│       └── seed_busdata.js         # Nạp database/busdata vào CSDL (npm run seed:busdata)
├── docs/
│   ├── DATABASE_SPECIFICATION.md   # Đặc tả CSDL không gian, từ điển dữ liệu, nguồn dữ liệu
│   ├── KIEN_TRUC_HE_THONG.md       # Đặc tả kiến trúc hệ thống
│   ├── BUSDATA_INTEGRATION_PLAN.md # Kế hoạch & tiến độ tích hợp dữ liệu busdata
│   └── NODEJS_VS_LARAVEL_ANALYSIS.md # Phân tích so sánh công nghệ Backend (Node.js vs Laravel)
├── frontend/
│   ├── index.html                  # Giao diện bản đồ giám sát 2D Realtime (ArcGIS JS SDK v4.29)
│   ├── admin.html                  # Trang Quản trị Admin Portal (Auth, CRUD & JSON Importer)
│   ├── path-editor.html            # Công cụ kéo thả sửa lộ trình & vị trí trạm trên bản đồ
│   ├── css/
│   │   ├── map.css                 # Style trang bản đồ
│   │   ├── admin.css               # Style trang quản trị
│   │   └── editor.css              # Style công cụ sửa lộ trình
│   └── js/                         # Classic scripts (không build), nạp theo thứ tự trong HTML
│       ├── common/                 # config.js (API_BASE, token keys, map center), api.js
│       ├── map/                    # toast, auth, map, routes, realtime, main
│       ├── admin/                  # api (cache), ui (modal/tab), auth, dashboard, routes, stops,
│       │                           # vehicles, schedules, users, import, main
│       └── editor/                 # map (SketchViewModel), analysis (đoạn nhảy, trạm lệch), main (hoàn tác, lưu)
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
* **Khách / Chỉ xem (VIEWER):** `khach` / `khach123`, `viewer` / `viewer123`

---

## 🚀 Hướng dẫn khởi chạy

### 1. Khởi động Cơ sở dữ liệu (MariaDB Spatial)
```bash
docker start bus-gis-mariadb
```
* Container MariaDB 10.4 lắng nghe cổng `3306`, tài khoản `root` không mật khẩu (cấu hình qua `backend/.env` nếu khác).
* Lần đầu khởi động backend, server tự tạo database `bus_management_db` và nạp `database/schema.sql` (tạo bảng + tài khoản người dùng).
* **CSDL tạo từ phiên bản cũ** (trước khi tích hợp busdata) cần chạy migration một lần:
  ```bash
  docker exec -i bus-gis-mariadb mysql -uroot bus_management_db < database/migrations/001_busdata_schema.sql
  ```

### 2. Khởi động Backend Server
```bash
cd backend
npm start
```
> Server sẽ lắng nghe tại: `http://localhost:3000`
>
> Test local không cần đăng nhập: `DISABLE_AUTH=true npm start` (mọi request chạy với quyền admin — **không dùng khi triển khai**).

### 3. Nạp dữ liệu xe buýt TP.HCM
```bash
cd backend
npm run seed:busdata
```
* Nạp 178 tuyến, 5.898 trạm, 332 lộ trình và 13.772 liên kết trạm–tuyến từ `database/busdata/`.
* Script **xóa toàn bộ** tuyến/trạm/lộ trình/xe/lịch chạy/nhật ký GPS hiện có (giữ nguyên tài khoản người dùng) rồi nạp lại; chạy lại nhiều lần cho cùng kết quả.

### 4. Khởi động Bộ giả lập GPS xe buýt (tùy chọn)
Mở một cửa sổ Terminal mới:
```bash
cd backend
npm run simulate
```
> ⚠️ Với dữ liệu thực tế, simulator hiện tự sinh ~900 xe ảo (2–3 xe cho mỗi lộ trình chưa có lịch). Việc giới hạn số xe thuộc Milestone 3 trong `docs/BUSDATA_INTEGRATION_PLAN.md`.

### 5. Phục vụ & truy cập Frontend
```bash
python3 -m http.server 8080 --directory frontend
```
* **Giao diện Bản đồ Giám sát Real-time:** `http://localhost:8080/`
* **Trang Quản trị Hệ thống (Admin Portal):** `http://localhost:8080/admin.html`
* **Công cụ sửa lộ trình (kéo thả):** `http://localhost:8080/path-editor.html?route_id=<route_id>&direction=1` — mở từ nút <i>Sửa trên bản đồ</i> ở tab Tuyến xe. Lưu ý: chạy lại `npm run seed:busdata` sẽ ghi đè mọi chỉnh sửa.
* **Công cụ chuyển tọa độ Google Maps:** `tools/google_maps_importer.html`
