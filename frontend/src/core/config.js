// Frontend được Express phục vụ cùng origin với API → đường dẫn tương đối, để truy cập qua
// IP LAN hoặc tunnel HTTPS trên điện thoại vẫn gọi đúng server (không phải "localhost" của điện thoại).
export const API_BASE = "/api/v1";

// Token theo trang: bản đồ & admin dùng chung (đăng nhập một lần); trang tài xế tách riêng
export const TOKEN_KEY = "bus_admin_token";
export const DRIVER_TOKEN_KEY = "bus_driver_token";
