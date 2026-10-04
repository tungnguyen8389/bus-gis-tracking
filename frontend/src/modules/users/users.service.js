import { request } from "../../core/http.js";

export function listUsers() {
  return request("/users", { auth: true });
}

export function createUser(payload) {
  return request("/users", { method: "POST", body: payload, auth: true });
}

// password rỗng → giữ nguyên mật khẩu cũ
export function updateUser(userId, payload) {
  return request(`/users/${userId}`, { method: "PUT", body: payload, auth: true });
}

export function deleteUser(userId) {
  return request(`/users/${userId}`, { method: "DELETE", auth: true });
}
