// --------------------------------------------------------------------
// ĐĂNG NHẬP QUẢN TRỊ & CHỌN SIDEBAR THEO VAI TRÒ
// ADMIN/MANAGER → điều khiển tuyến + nút Quản Trị, còn lại (khách) → tìm tuyến + nút Đăng nhập.
// Token dùng chung khóa bus_admin_token với admin.html nên mở trang quản trị không phải đăng nhập lại.
// --------------------------------------------------------------------
import { state } from "../map.state.js";
import { showToast } from "../../../core/toast.js";
import { getToken, setToken, clearToken } from "../../../core/session.js";
import { ApiError } from "../../../core/http.js";
import { clearRouteGraphics } from "./base-map.js";
import { applyFleetFilter, connectFleetSocket } from "./fleet-tracking.js";
import { loadRoutesList, resetDirection } from "./route-browser.js";
import { loadStopIndex, hasStopIndex, clearTripLayer } from "./trip-finder/trip-finder.js";
import { resetTripWatch } from "./trip-finder/trip-watch.js";
import { isStaffRole, login, getCurrentUser } from "../../../modules/auth/auth.service.js";

async function getStaffUser() {
  if (!getToken()) return null;
  try {
    const user = await getCurrentUser();
    return isStaffRole(user) ? user : null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) clearToken();
    return null;
  }
}

function applyAuthState(user) {
  const isStaff = isStaffRole(user);
  const show = (id, visible, display = "flex") => {
    document.getElementById(id).style.display = visible ? display : "none";
  };
  show("btnOpenLogin", !isStaff);
  show("btnTopAdminPortal", isStaff);
  show("btnLogout", isStaff);
  show("btnBottomAdminLink", isStaff, "block");
  show("routeControlPanel", isStaff);
  show("guestTripPanel", !isStaff);
  // Bảng "Theo dõi xe": nhân viên luôn thấy; khách chỉ thấy khi đang theo dõi 1 chuyến
  show("fleetDashboard", isStaff, "block");
  show("nextStopBlock", isStaff, "block");
  show("guestTripInfo", false, "block");
  state.isStaff = isStaff;
  resetTripWatch();
  connectFleetSocket(isStaff ? getToken() : null);

  clearTripLayer();
  if (isStaff) {
    resetDirection();
    loadRoutesList();
  } else {
    // Trả bản đồ về trạng thái khách: chưa chọn tuyến, hiện mọi xe
    state.currentSelectedRoute = "ALL";
    state.currentRawStops = [];
    clearRouteGraphics();
    document.querySelectorAll("#tripResults .trip-card.active").forEach(c => c.classList.remove("active"));
    document.querySelectorAll("#tripResults .trip-schedules").forEach(el => el.remove());
    applyFleetFilter();
    if (state.allRoutes.length === 0) loadRoutesList(false);
    if (!hasStopIndex()) loadStopIndex();
  }
}

export async function initSidebarForRole() {
  applyAuthState(await getStaffUser());
}

export function openLoginModal() {
  document.getElementById("loginAlert").style.display = "none";
  document.getElementById("loginPassword").value = "";
  document.getElementById("loginModal").classList.add("open");
  document.getElementById("loginUsername").focus();
}

export function closeLoginModal() {
  document.getElementById("loginModal").classList.remove("open");
}

export function bindLoginModalKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("loginModal").classList.contains("open")) closeLoginModal();
  });
}

export async function handleStaffLogin(e) {
  e.preventDefault();
  const btn = document.getElementById("btnLoginSubmit");
  const alertBox = document.getElementById("loginAlert");
  alertBox.style.display = "none";
  btn.disabled = true;
  try {
    const data = await login(
      document.getElementById("loginUsername").value.trim(),
      document.getElementById("loginPassword").value
    );
    if (!isStaffRole(data.user)) throw new Error(data.error || "Đăng nhập thất bại");

    setToken(data.token);
    closeLoginModal();
    applyAuthState(data.user);
    showToast(`Xin chào ${data.user.full_name || data.user.username}!`, "success");
  } catch (err) {
    const message = err instanceof ApiError ? (err.data?.error || "Đăng nhập thất bại") : err.message;
    alertBox.textContent = message === "Failed to fetch" ? "Không thể kết nối đến máy chủ (Port 3000)" : message;
    alertBox.style.display = "block";
  } finally {
    btn.disabled = false;
  }
}

export function logoutStaff() {
  clearToken();
  applyAuthState(null);
  showToast("Đã đăng xuất.", "info");
}
