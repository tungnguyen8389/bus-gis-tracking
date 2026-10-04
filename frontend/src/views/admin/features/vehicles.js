// Tab Quản lý Đội xe
import { state } from "../admin.state.js";
import { openModal, closeModal } from "../../../core/modal.js";
import { escapeHtml } from "../../../core/dom.js";
import { apiErrorMessage, ignoreApiError } from "../../../core/http.js";
import { loadDashboardStats } from "./dashboard.js";
import { listVehicles, createVehicle, updateVehicle, deleteVehicle as removeVehicle } from "../../../modules/vehicles/vehicles.service.js";

// Nạp danh sách xe nếu chưa có (dùng cho dropdown tab Phân công chuyến)
export async function ensureVehiclesLoaded() {
  if (state.vehicles.length === 0) state.vehicles = await listVehicles();
  return state.vehicles;
}

export async function loadVehicles() {
  try {
    state.vehicles = await listVehicles();
    const tbody = document.getElementById("vehicles-table-body");
    tbody.innerHTML = state.vehicles.map(v => {
      const routesDisplay = v.assigned_routes
        ? `<span style="color: #0369a1; font-weight: 600;">${escapeHtml(v.assigned_routes)}</span> <span class="badge badge-manager">${escapeHtml(v.total_trips)} chuyến</span>`
        : `<span style="color: #94a3b8; font-style: italic;">Chưa gán chuyến</span>`;

      return `
        <tr>
          <td><b>${escapeHtml(v.vehicle_id)}</b></td>
          <td><span class="badge badge-manager">${escapeHtml(v.plate_number)}</span></td>
          <td>${escapeHtml(v.capacity)} chỗ</td>
          <td>${escapeHtml(v.driver_name || "---")}</td>
          <td><span class="badge ${v.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}">${escapeHtml(v.status)}</span></td>
          <td>${routesDisplay}</td>
          <td>
            <button class="btn btn-sm btn-success" data-action="openScheduleModal" data-vehicle="${escapeHtml(v.vehicle_id)}" title="Phân công xe vào Chuyến/Tuyến"><i class="fa-solid fa-calendar-plus"></i></button>
            <button class="btn btn-sm btn-primary" data-action="editVehicle" data-id="${escapeHtml(v.vehicle_id)}" title="Sửa thông tin xe"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-action="deleteVehicle" data-id="${escapeHtml(v.vehicle_id)}" title="Xóa xe"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join("");
  } catch (e) {}
}

export function openVehicleModal(editData = null) {
  document.getElementById("form-vehicle").reset();
  const idInput = document.getElementById("vehicle_id");
  if (editData) {
    document.getElementById("modal-vehicle-title").innerText = "Cập nhật Phương tiện";
    idInput.value = editData.vehicle_id;
    idInput.disabled = true;
    document.getElementById("plate_number").value = editData.plate_number;
    document.getElementById("vehicle_capacity").value = editData.capacity;
    document.getElementById("driver_name").value = editData.driver_name;
    document.getElementById("vehicle_status").value = editData.status;
  } else {
    document.getElementById("modal-vehicle-title").innerText = "Thêm Xe Buýt Mới";
    idInput.disabled = false;
  }
  openModal("modal-vehicle");
}

export function editVehicle(id) {
  const item = state.vehicles.find(v => v.vehicle_id === id);
  if (item) openVehicleModal(item);
}

export async function saveVehicle(e) {
  e.preventDefault();
  const id = document.getElementById("vehicle_id").value;
  const isEdit = document.getElementById("vehicle_id").disabled;
  const payload = {
    vehicle_id: id,
    plate_number: document.getElementById("plate_number").value,
    capacity: parseInt(document.getElementById("vehicle_capacity").value),
    driver_name: document.getElementById("driver_name").value,
    status: document.getElementById("vehicle_status").value
  };

  try {
    await (isEdit ? updateVehicle(id, payload) : createVehicle(payload));
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi lưu xe"));
    return;
  }
  closeModal("modal-vehicle");
  loadVehicles();
  loadDashboardStats();
}

export async function deleteVehicle(id) {
  if (!confirm(`Xóa xe '${id}'?`)) return;
  await removeVehicle(id).then(() => {
    loadVehicles();
    loadDashboardStats();
  }, ignoreApiError);
}
