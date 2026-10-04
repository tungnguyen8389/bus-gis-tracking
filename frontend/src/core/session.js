import { TOKEN_KEY } from "./config.js";

// key: khóa localStorage theo trang (mặc định token nhân viên của bản đồ/admin)
export function getToken(key = TOKEN_KEY) {
  return localStorage.getItem(key);
}

export function setToken(token, key = TOKEN_KEY) {
  localStorage.setItem(key, token);
}

export function clearToken(key = TOKEN_KEY) {
  localStorage.removeItem(key);
}
