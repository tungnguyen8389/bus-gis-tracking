# HỆ THỐNG QUẢN LÝ VÀ GIÁM SÁT HÀNH TRÌNH XE BUÝT 2D (WEB GIS)

Dự án môn Hệ Thống Thông Tin Địa Lý (IE402) - Ứng dụng công nghệ ArcGIS Maps SDK for JavaScript, Node.js WebSocket Hub và MySQL 8.x Spatial.

---

## 📁 Cấu trúc thư mục

```
Bus_project/
├── database/
│   └── schema.sql                  # Lược đồ CSDL MySQL 8.x Spatial + Seed dữ liệu ĐHQG
├── backend/
│   ├── .env                        # File cấu hình môi trường (Port, DB connection)
│   ├── package.json                # Dependencies Express, Socket.io, MySQL2
│   ├── server.js                   # REST API GeoJSON & Socket.io Realtime Hub
│   └── simulator.js                # Bộ phát GPS giả lập lộ trình xe buýt
├── docs/
│   └── NODEJS_VS_LARAVEL_ANALYSIS.md # Phân tích so sánh công nghệ Backend (Node.js vs Laravel)
├── frontend/
│   ├── index.html                  # Giao diện bản đồ giám sát 2D Realtime (ArcGIS JS SDK v4.29)
│   └── admin.html                  # Trang Quản trị Admin Portal (Auth, CRUD & JSON Importer)
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
* Khi khởi động backend, server sẽ tự động tạo database `bus_management_db` và nạp schema nếu chưa có (hoặc bạn có thể import thủ công `database/schema.sql`).

### 2. Khởi động Backend Server
```bash
cd backend
npm start
```
> Server sẽ lắng nghe tại: `http://localhost:3000`

### 3. Khởi động Bộ giả lập GPS xe buýt
Mở một cửa sổ Terminal mới:
```bash
cd backend
npm run simulate
```

### 4. Truy cập Hệ thống
* **Giao diện Bản đồ Giám sát Real-time:** `http://localhost/Bus_project/frontend/index.html`
* **Trang Quản trị Hệ thống (Admin Portal):** `http://localhost/Bus_project/frontend/admin.html`
* **Công cụ lấy tọa độ:** `tools/coordinate_picker.html`
* **Công cụ chuyển tọa độ Google Maps:** `tools/google_maps_importer.html`

