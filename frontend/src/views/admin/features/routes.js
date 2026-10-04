// Tab Quản lý Tuyến xe
import { state } from "../admin.state.js";
import { openModal, closeModal } from "../../../core/modal.js";
import { escapeHtml } from "../../../core/dom.js";
import { apiErrorMessage, ignoreApiError } from "../../../core/http.js";
import { listRoutes, createRoute, updateRoute, deleteRoute as removeRoute } from "../../../modules/bus-routes/bus-routes.service.js";

// Nạp danh sách tuyến nếu chưa có (dùng cho dropdown ở các tab khác)
export async function ensureRoutesLoaded() {
  if (state.routes.length === 0) state.routes = await listRoutes();
  return state.routes;
}

// <option> cho dropdown chọn tuyến
export function routeOptionsHtml() {
  return state.routes.map(r => `<option value="${escapeHtml(r.route_id)}">Tuyến ${escapeHtml(r.route_number)}: ${escapeHtml(r.route_name)}</option>`).join("");
}

export async function loadRoutes() {
  try {
    state.routes = await listRoutes({ auth: true });
    const tbody = document.getElementById("routes-table-body");
    tbody.innerHTML = state.routes.map(r => `
        <tr>
          <td><b>${escapeHtml(r.route_id)}</b></td>
          <td><span class="badge badge-manager">Tuyến ${escapeHtml(r.route_number)}</span></td>
          <td>${escapeHtml(r.route_name)}</td>
          <td>${escapeHtml(r.distance_km)} km</td>
          <td>${escapeHtml(r.headway_min)} ph</td>
          <td>${escapeHtml(r.total_stops)} trạm</td>
          <td>${r.total_paths > 0 ? '<span class="badge badge-active">Đã có lộ trình</span>' : '<span class="badge badge-inactive">Chưa vẽ lộ trình</span>'}</td>
          <td>
            <button class="btn btn-sm btn-primary" data-action="editRoute" data-id="${escapeHtml(r.route_id)}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-action="deleteRoute" data-id="${escapeHtml(r.route_id)}"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `).join("");
  } catch (e) {}
}

export function openRouteModal(editData = null) {
  document.getElementById("form-route").reset();
  const title = document.getElementById("modal-route-title");
  const idInput = document.getElementById("route_id");
  if (editData) {
    title.innerText = "Cập nhật Tuyến xe";
    idInput.value = editData.route_id;
    idInput.disabled = true;
    document.getElementById("route_number").value = editData.route_number;
    document.getElementById("route_name").value = editData.route_name;
    document.getElementById("route_distance").value = editData.distance_km;
    document.getElementById("route_headway").value = editData.headway_min;
  } else {
    title.innerText = "Thêm Tuyến Xe Mới";
    idInput.disabled = false;
  }
  openModal("modal-route");
}

export function editRoute(id) {
  const item = state.routes.find(r => r.route_id === id);
  if (item) openRouteModal(item);
}

export async function saveRoute(e) {
  e.preventDefault();
  const id = document.getElementById("route_id").value;
  const isEdit = document.getElementById("route_id").disabled;
  const payload = {
    route_id: id,
    route_number: document.getElementById("route_number").value,
    route_name: document.getElementById("route_name").value,
    distance_km: parseFloat(document.getElementById("route_distance").value),
    headway_min: parseInt(document.getElementById("route_headway").value)
  };

  try {
    await (isEdit ? updateRoute(id, payload) : createRoute(payload));
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi lưu tuyến"));
    return;
  }
  closeModal("modal-route");
  loadRoutes();
}

export async function deleteRoute(id) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tuyến '${id}'?`)) return;
  await removeRoute(id).then(() => loadRoutes(), ignoreApiError);
}
