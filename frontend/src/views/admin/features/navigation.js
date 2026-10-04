// Chuyển tab trong trang quản trị
import { loadDashboardStats } from "./dashboard.js";
import { loadRoutes } from "./routes.js";
import { loadRoutesForFilter, loadStops } from "./stops.js";
import { loadVehicles } from "./vehicles.js";
import { loadScheduleFilterDropdowns, loadSchedules } from "./schedules.js";
import { onJsonHubShown } from "./json-hub.js";
import { loadUsers } from "./users.js";

const TAB_TITLES = {
  "dashboard": "Tổng quan Hệ thống",
  "routes": "Quản lý Tuyến xe & Lộ trình (GIS)",
  "stops": "Quản lý Trạm Dừng theo Tuyến & Chiều",
  "vehicles": "Quản lý Đội xe Buýt",
  "schedules": "Phân Công Chuyến Xe & Lịch Trình Khởi Hành",
  "json-hub": "Nhập / Xuất Dữ liệu JSON & Tọa độ",
  "users": "Quản lý Người dùng & Phân quyền"
};

// Dữ liệu nạp lại mỗi khi mở tab
const TAB_LOADERS = {
  "dashboard": () => loadDashboardStats(),
  "routes": () => loadRoutes(),
  "stops": () => { loadRoutesForFilter(); loadStops(); },
  "vehicles": () => loadVehicles(),
  "schedules": () => { loadScheduleFilterDropdowns(); loadSchedules(); },
  "json-hub": () => onJsonHubShown(),
  "users": () => loadUsers()
};

export function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(el => el.classList.remove("active"));

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) targetPane.classList.add("active");
  const navItem = document.querySelector(`.nav-item[data-arg="${tabId}"]`);
  if (navItem) navItem.classList.add("active");

  document.getElementById("page-title").innerText = TAB_TITLES[tabId] || "Quản trị";

  const load = TAB_LOADERS[tabId];
  if (load) load();
}
