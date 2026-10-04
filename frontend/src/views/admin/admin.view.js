// Entry trang quản trị (admin.html)
import { mountSections } from "../../core/dom.js";
import { registerActions } from "../../core/actions.js";
import { closeModal } from "../../core/modal.js";
import { checkAuth, handleLogin, handleLogout } from "./features/auth.js";
import { switchTab } from "./features/navigation.js";
import { loadDashboardStats } from "./features/dashboard.js";
import { openRouteModal, editRoute, saveRoute, deleteRoute } from "./features/routes.js";
import {
  onStopFilterChanged, loadStops, openStopModal, editStop, saveStop, deleteStop,
  openAssignStopModal, saveAssignStop, removeStopFromRoute
} from "./features/stops.js";
import { openVehicleModal, editVehicle, saveVehicle, deleteVehicle } from "./features/vehicles.js";
import {
  loadSchedules, openScheduleModal, editSchedule, saveSchedule, deleteSchedule, resetScheduleFilters
} from "./features/schedules.js";
import {
  initPreviewMap, handleImportTypeChange, onJsonInputChanged, handleFileUpload,
  previewJsonOnMap, submitImportJson, exportData
} from "./features/json-hub.js";
import { openUserModal, editUser, saveUser, deleteUser } from "./features/users.js";

registerActions({
  // auth & điều hướng
  handleLogin: (el, e) => handleLogin(e),
  handleLogout: () => handleLogout(),
  switchTab: el => switchTab(el.dataset.arg),
  closeModal: el => closeModal(el.dataset.arg),
  // dashboard
  loadDashboardStats: () => loadDashboardStats(),
  // tuyến xe
  openRouteModal: () => openRouteModal(),
  editRoute: el => editRoute(el.dataset.id),
  saveRoute: (el, e) => saveRoute(e),
  deleteRoute: el => deleteRoute(el.dataset.id),
  // trạm dừng
  onStopFilterChanged: () => onStopFilterChanged(),
  loadStops: () => loadStops(),
  openStopModal: () => openStopModal(),
  editStop: el => editStop(el.dataset.id),
  saveStop: (el, e) => saveStop(e),
  deleteStop: el => deleteStop(el.dataset.id),
  openAssignStopModal: () => openAssignStopModal(),
  saveAssignStop: (el, e) => saveAssignStop(e),
  removeStopFromRoute: el => removeStopFromRoute(el.dataset.route, el.dataset.stop, el.dataset.dir, el.dataset.order),
  // đội xe
  openVehicleModal: () => openVehicleModal(),
  editVehicle: el => editVehicle(el.dataset.id),
  saveVehicle: (el, e) => saveVehicle(e),
  deleteVehicle: el => deleteVehicle(el.dataset.id),
  // phân công chuyến (schedule_id là số → Number để khớp ===)
  loadSchedules: () => loadSchedules(),
  openScheduleModal: el => openScheduleModal(null, el.dataset.vehicle || null),
  editSchedule: el => editSchedule(Number(el.dataset.id)),
  saveSchedule: (el, e) => saveSchedule(e),
  deleteSchedule: el => deleteSchedule(Number(el.dataset.id)),
  resetScheduleFilters: () => resetScheduleFilters(),
  // nhập / xuất JSON
  handleImportTypeChange: () => handleImportTypeChange(),
  onJsonInputChanged: () => onJsonInputChanged(),
  handleFileUpload: (el, e) => handleFileUpload(e),
  previewJsonOnMap: () => previewJsonOnMap(),
  submitImportJson: () => submitImportJson(),
  exportData: el => exportData(el.dataset.arg),
  // người dùng (user_id là số)
  openUserModal: () => openUserModal(),
  editUser: el => editUser(Number(el.dataset.id)),
  saveUser: (el, e) => saveUser(e),
  deleteUser: el => deleteUser(Number(el.dataset.id))
});

await mountSections(import.meta.url);
initPreviewMap();
checkAuth();
