import { state } from "../driver.state.js";
import { DRIVER_TOKEN_KEY } from "../../../core/config.js";
import { getToken, setToken, clearToken } from "../../../core/session.js";
import { ApiError, apiErrorMessage } from "../../../core/http.js";
import { showToast } from "../../../core/toast.js";
import { driverLogin, getDriverMe } from "../../../modules/driver/driver.service.js";

async function loadProfile() {
  const me = await getDriverMe();
  state.user = me.user;
  state.vehicle = me.vehicle;
  state.schedules = me.schedules;
}

// Có token còn hạn → nạp hồ sơ; token hỏng/hết hạn (401/403) → xóa và về màn đăng nhập
export async function restoreSession() {
  if (!getToken(DRIVER_TOKEN_KEY)) return false;
  try {
    await loadProfile();
    return true;
  } catch (err) {
    // Chỉ 401/403 mới xóa token; lỗi 5xx hoặc mất mạng giữ token để thử lại
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) clearToken(DRIVER_TOKEN_KEY);
    else showToast("Không kết nối được máy chủ", "error");
    return false;
  }
}

export async function handleLogin() {
  const errorEl = document.getElementById("loginError");
  errorEl.hidden = true;
  const username = document.getElementById("driverUsername").value.trim();
  const passwordEl = document.getElementById("driverPassword");
  try {
    const { token } = await driverLogin(username, passwordEl.value);
    setToken(token, DRIVER_TOKEN_KEY);
    await loadProfile();
    passwordEl.value = "";
    return true;
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? apiErrorMessage(err, "Đăng nhập thất bại") : "Không kết nối được máy chủ";
    errorEl.hidden = false;
    return false;
  }
}

export function logout() {
  clearToken(DRIVER_TOKEN_KEY);
  state.user = null;
  state.vehicle = null;
  state.schedules = [];
  state.schedule = null;
}
