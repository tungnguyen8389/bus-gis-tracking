// --------------------------------------------------------------------
// Tab Phân công Chuyến & Xe (Schedules & Trip Assignments)
// --------------------------------------------------------------------
import { state } from "../admin.state.js";
import { openModal, closeModal } from "../../../core/modal.js";
import { ApiError } from "../../../core/http.js";
import { loadDashboardStats } from "./dashboard.js";
import { ensureRoutesLoaded, routeOptionsHtml } from "./routes.js";
import { ensureVehiclesLoaded, loadVehicles } from "./vehicles.js";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule as removeSchedule } from "../../../modules/schedules/schedules.service.js";

export async function loadScheduleFilterDropdowns() {
  try {
    await ensureRoutesLoaded();
    const routeSelect = document.getElementById("schedule_filter_route");
    const curRoute = routeSelect.value;
    routeSelect.innerHTML = `<option value="ALL">🌐 Tất cả các tuyến</option>` + routeOptionsHtml();
    if (curRoute) routeSelect.value = curRoute;

    await ensureVehiclesLoaded();
    const vehSelect = document.getElementById("schedule_filter_vehicle");
    const curVeh = vehSelect.value;
    vehSelect.innerHTML = `<option value="ALL">Tất cả xe buýt</option>` +
      state.vehicles.map(v => `<option value="${v.vehicle_id}">${v.plate_number} (${v.vehicle_id})</option>`).join("");
    if (curVeh) vehSelect.value = curVeh;
  } catch (e) {}
}

export async function loadSchedules() {
  const tbody = document.getElementById("schedules-table-body");
  tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>Đang tải danh sách phân công chuyến...</td></tr>";

  try {
    state.schedules = await listSchedules({
      route_id: document.getElementById("schedule_filter_route").value,
      direction: document.getElementById("schedule_filter_dir").value,
      vehicle_id: document.getElementById("schedule_filter_vehicle").value
    });

    if (state.schedules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">Chưa có chuyến xe nào được phân công phù hợp với bộ lọc. Hãy bấm <b>"Phân Công Chuyến Mới"</b> để gán xe vào tuyến!</td></tr>`;
      return;
    }

    tbody.innerHTML = state.schedules.map(s => {
      const dirLabel = s.direction === 1
        ? `<span class="badge badge-active"><i class="fa-solid fa-arrow-right"></i> Chiều 1 (Lượt đi)</span>`
        : `<span class="badge badge-inactive"><i class="fa-solid fa-arrow-left"></i> Chiều 2 (Lượt về)</span>`;

      const vehStatus = s.vehicle_status === "ACTIVE"
        ? `<span class="badge badge-active">${s.vehicle_status}</span>`
        : `<span class="badge badge-inactive">${s.vehicle_status || 'UNKNOWN'}</span>`;

      // Format departure time HH:mm
      const timeFormatted = s.departure_time ? s.departure_time.substring(0, 5) : "---";

      return `
        <tr>
          <td><b>#SCH_${s.schedule_id}</b></td>
          <td><span style="font-size: 15px; font-weight: 700; color: #0284c7;"><i class="fa-regular fa-clock"></i> ${timeFormatted}</span></td>
          <td><span class="badge badge-manager">Tuyến ${s.route_number}</span> <b>${s.route_name}</b></td>
          <td>${dirLabel}</td>
          <td><span style="font-weight: 600; color: #1e293b;">${s.plate_number}</span> <small style="color: #64748b;">(${s.vehicle_id})</small></td>
          <td>${s.driver_name || "---"}</td>
          <td>${vehStatus}</td>
          <td>
            <button class="btn btn-sm btn-primary" data-action="editSchedule" data-id="${s.schedule_id}" title="Sửa chuyến"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-action="deleteSchedule" data-id="${s.schedule_id}" title="Hủy phân công"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
  }
}

async function populateModalScheduleDropdowns(selectedRouteId = null, selectedVehicleId = null) {
  await ensureRoutesLoaded();
  const routeSelect = document.getElementById("modal_schedule_route_id");
  routeSelect.innerHTML = routeOptionsHtml();
  if (selectedRouteId) routeSelect.value = selectedRouteId;

  await ensureVehiclesLoaded();
  const vehSelect = document.getElementById("modal_schedule_vehicle_id");
  vehSelect.innerHTML = state.vehicles
    .map(v => `<option value="${v.vehicle_id}">${v.plate_number} - Tài xế: ${v.driver_name || 'Chưa gán'} (${v.status})</option>`)
    .join("");
  if (selectedVehicleId) vehSelect.value = selectedVehicleId;
}

export async function openScheduleModal(editData = null, preVehicleId = null, preRouteId = null) {
  document.getElementById("form-schedule").reset();
  await populateModalScheduleDropdowns(
    editData ? editData.route_id : preRouteId,
    editData ? editData.vehicle_id : preVehicleId
  );

  const idInput = document.getElementById("edit_schedule_id");
  const title = document.getElementById("modal-schedule-title");

  if (editData) {
    title.innerText = "Cập Nhật Phân Công Chuyến Xe";
    idInput.value = editData.schedule_id;
    document.getElementById("modal_schedule_route_id").value = editData.route_id;
    document.getElementById("modal_schedule_direction").value = editData.direction;
    document.getElementById("modal_schedule_vehicle_id").value = editData.vehicle_id;
    document.getElementById("modal_schedule_departure_time").value = editData.departure_time ? editData.departure_time.substring(0, 5) : "06:30";
  } else {
    title.innerText = "Phân Công Xe Vào Chuyến Mới";
    idInput.value = "";
    if (preRouteId) document.getElementById("modal_schedule_route_id").value = preRouteId;
    if (preVehicleId) document.getElementById("modal_schedule_vehicle_id").value = preVehicleId;
    document.getElementById("modal_schedule_departure_time").value = "06:30";
  }
  openModal("modal-schedule");
}

export function editSchedule(id) {
  const item = state.schedules.find(s => s.schedule_id === id);
  if (item) openScheduleModal(item);
}

export async function saveSchedule(e) {
  e.preventDefault();
  const schedId = document.getElementById("edit_schedule_id").value;
  const isEdit = Boolean(schedId);

  const payload = {
    route_id: document.getElementById("modal_schedule_route_id").value,
    direction: parseInt(document.getElementById("modal_schedule_direction").value),
    vehicle_id: document.getElementById("modal_schedule_vehicle_id").value,
    departure_time: document.getElementById("modal_schedule_departure_time").value + ":00"
  };

  try {
    await (isEdit ? updateSchedule(schedId, payload) : createSchedule(payload));
    closeModal("modal-schedule");
    loadSchedules();
    loadVehicles();
    loadDashboardStats();
  } catch (err) {
    if (err instanceof ApiError) alert("Lỗi: " + ((err.data && err.data.error) || "Không thể lưu phân công chuyến"));
    else alert("Lỗi kết nối: " + err.message);
  }
}

export async function deleteSchedule(id) {
  if (!confirm(`Hủy phân công chuyến xe #SCH_${id}?`)) return;
  try {
    await removeSchedule(id);
    loadSchedules();
    loadVehicles();
    loadDashboardStats();
  } catch (err) {
    if (err instanceof ApiError) alert("Lỗi xóa chuyến: " + (err.data && err.data.error));
    else alert("Lỗi kết nối: " + err.message);
  }
}

export function resetScheduleFilters() {
  document.getElementById("schedule_filter_route").value = "ALL";
  document.getElementById("schedule_filter_dir").value = "ALL";
  document.getElementById("schedule_filter_vehicle").value = "ALL";
  loadSchedules();
}
