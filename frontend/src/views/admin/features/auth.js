// Màn hình đăng nhập & phiên làm việc trang quản trị
import { state } from "../admin.state.js";
import { getToken, setToken, clearToken } from "../../../core/session.js";
import { ApiError } from "../../../core/http.js";
import { loadDashboardStats } from "./dashboard.js";
import { loadRoutes } from "./routes.js";
import { login, getCurrentUser } from "../../../modules/auth/auth.service.js";

const showAuthScreen = visible => {
  document.getElementById("auth-screen").style.display = visible ? "flex" : "none";
};

export async function checkAuth() {
  if (!getToken()) {
    showAuthScreen(true);
    return;
  }

  try {
    state.currentUser = await getCurrentUser();
    showAuthScreen(false);
    document.getElementById("user-display-name").innerText = state.currentUser.full_name;
    document.getElementById("user-display-role").innerText = state.currentUser.role;

    if (state.currentUser.role !== "ADMIN") {
      const navUsers = document.getElementById("nav-users");
      if (navUsers) navUsers.style.display = "none";
    }
    loadDashboardStats();
    loadRoutes();
  } catch (err) {
    if (err instanceof ApiError) clearToken();
    showAuthScreen(true);
  }
}

export async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login_username").value;
  const password = document.getElementById("login_password").value;
  const alertBox = document.getElementById("login-alert");

  try {
    const data = await login(username, password);
    setToken(data.token);
    alertBox.style.display = "none";
    checkAuth();
  } catch (err) {
    alertBox.innerText = err instanceof ApiError
      ? ((err.data && err.data.error) || "Đăng nhập thất bại")
      : "Không thể kết nối đến máy chủ: " + err.message;
    alertBox.style.display = "block";
  }
}

export function handleLogout() {
  clearToken();
  location.reload();
}
