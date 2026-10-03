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
const MAP_DEFAULT_CENTER = [106.80196, 10.87052]; // Khu vực ĐHQG TP.HCM
const MAP_DEFAULT_ZOOM = 14;
