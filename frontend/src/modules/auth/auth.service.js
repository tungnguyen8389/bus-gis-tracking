import { request } from "../../core/http.js";

// Chỉ ADMIN/MANAGER được đăng nhập (server trả 403 với vai trò khác)
export function isStaffRole(user) {
  return !!user && (user.role === "ADMIN" || user.role === "MANAGER");
}

// → { message, token, user }
export function login(username, password) {
  return request("/auth/login", { method: "POST", body: { username, password } });
}

// Thông tin người dùng của token hiện tại
export function getCurrentUser() {
  return request("/auth/me", { auth: true });
}
