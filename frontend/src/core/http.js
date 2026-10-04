import { API_BASE } from "./config.js";
import { getToken } from "./session.js";

// Lỗi HTTP từ API (status != 2xx). Lỗi mạng (TypeError "Failed to fetch") được ném nguyên trạng.
export class ApiError extends Error {
  constructor(status, data) {
    super((data && data.error) || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// Thông báo lỗi từ API ({ error } của server) hoặc fallback. Lỗi mạng không phải ApiError → ném tiếp.
export function apiErrorMessage(err, fallback) {
  if (!(err instanceof ApiError)) throw err;
  return (err.data && err.data.error) || fallback;
}

// Bỏ qua lỗi HTTP (thao tác chỉ cần làm mới khi thành công); lỗi mạng vẫn ném tiếp.
export function ignoreApiError(err) {
  if (!(err instanceof ApiError)) throw err;
}

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

/**
 * Gọi REST API và trả về JSON đã parse.
 * @param {string} path   Đường dẫn sau /api/v1 (VD: "/routes")
 * @param {object} opts   { method, body, auth } — auth: gửi kèm Bearer token
 */
export async function request(path, opts = {}) {
  const res = await send(path, opts);
  return res.json().catch(() => null);
}

// Như request() nhưng trả nội dung dạng Blob (tải file, VD: sao lưu JSON cần token)
export async function requestBlob(path, opts = {}) {
  const res = await send(path, opts);
  return res.blob();
}

async function send(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (auth) {
    headers["Content-Type"] = "application/json";
    headers["Authorization"] = `Bearer ${getToken()}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res;
}
