// --------------------------------------------------------------------
// CẤU HÌNH DÙNG CHUNG (Trang bản đồ & Trang quản trị)
// --------------------------------------------------------------------
const SERVER_URL = "http://localhost:3000";
const API_BASE = `${SERVER_URL}/api/v1`;

// Khóa localStorage: tách riêng token người dùng bản đồ và token quản trị
const USER_TOKEN_KEY = "bus_user_token";
const ADMIN_TOKEN_KEY = "bus_admin_token";

// Cấu hình bản đồ mặc định
const MAP_BASEMAP = "streets-navigation-vector";
const MAP_DEFAULT_CENTER = [106.70, 10.78]; // Trung tâm TP.HCM
const MAP_DEFAULT_ZOOM = 12;

// Trạm dừng: chỉ tải theo khung nhìn khi đủ gần để tránh tải toàn bộ ~6.000 trạm
const MAP_STOPS_MIN_ZOOM = 15;
const MAP_STOPS_VIEW_LIMIT = 500;
const STOPS_SEARCH_LIMIT = 50;
const STOP_STATUS_ACTIVE = "Đang khai thác";
