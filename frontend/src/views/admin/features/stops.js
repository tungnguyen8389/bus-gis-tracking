// --------------------------------------------------------------------
// Tab QUẢN LÝ TRẠM DỪNG THEO TUYẾN & CHIỀU
// --------------------------------------------------------------------
import { state } from "../admin.state.js";
import { openModal, closeModal } from "../../../core/modal.js";
import { escapeHtml } from "../../../core/dom.js";
import { apiErrorMessage, ignoreApiError } from "../../../core/http.js";
import { ensureRoutesLoaded, routeOptionsHtml } from "./routes.js";
import {
  listStops, createStop, updateStop, deleteStop as removeStop,
  listRouteStops, assignStopToRoute, removeStopFromRoute as unassignStop
} from "../../../modules/stops/stops.service.js";

export async function loadRoutesForFilter() {
  try {
    await ensureRoutesLoaded();
    const select = document.getElementById("stop_filter_route");
    const currentVal = select.value;
    select.innerHTML = `<option value="ALL">🌐 Tất cả các trạm trong hệ thống</option>` + routeOptionsHtml();
    if (currentVal) select.value = currentVal;
  } catch (e) {}
}

export function onStopFilterChanged() {
  const selectedRoute = document.getElementById("stop_filter_route").value;
  const dirGroup = document.getElementById("stop_filter_dir_group");
  const btnAssign = document.getElementById("btnAssignStop");

  if (selectedRoute === "ALL") {
    dirGroup.style.display = "none";
    btnAssign.style.display = "none";
  } else {
    dirGroup.style.display = "flex";
    btnAssign.style.display = "inline-flex";
  }
  loadStops();
}

export async function loadStops() {
  const routeId = document.getElementById("stop_filter_route").value;
  const direction = document.getElementById("stop_filter_dir").value;
  const header = document.getElementById("stops-table-header");
  const tbody = document.getElementById("stops-table-body");
  tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Đang tải...</td></tr>";

  try {
    if (routeId === "ALL") {
      // Hiển thị toàn bộ trạm trong hệ thống
      header.innerHTML = `
        <th>Mã trạm</th>
        <th>Tên trạm dừng</th>
        <th>Địa chỉ / Vị trí</th>
        <th>Kinh độ (Lon)</th>
        <th>Vĩ độ (Lat)</th>
        <th>Thao tác</th>
      `;
      const data = await listStops();
      state.allStops = data.features || [];

      tbody.innerHTML = state.allStops.map(f => {
        const p = f.properties;
        const coords = f.geometry.coordinates;
        return `
          <tr>
            <td><b>${escapeHtml(p.stop_id)}</b></td>
            <td>${escapeHtml(p.stop_name)}</td>
            <td>${escapeHtml(p.address || "---")}</td>
            <td>${coords[0].toFixed(6)}</td>
            <td>${coords[1].toFixed(6)}</td>
            <td>
              <button class="btn btn-sm btn-primary" data-action="editStop" data-id="${escapeHtml(p.stop_id)}"><i class="fa-solid fa-pen"></i></button>
              <button class="btn btn-sm btn-danger" data-action="deleteStop" data-id="${escapeHtml(p.stop_id)}"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `;
      }).join("");
    } else {
      // Hiển thị trạm thuộc tuyến & chiều được chọn
      header.innerHTML = `
        <th style="width: 70px;">Thứ tự</th>
        <th>Mã trạm</th>
        <th>Tên trạm dừng</th>
        <th>Địa chỉ</th>
        <th>Tọa độ [Lon, Lat]</th>
        <th>Thao tác</th>
      `;
      const stops = await listRouteStops(routeId, direction);

      if (stops.length === 0) {
        tbody.innerHTML = `<tr><td colspan='6' style='text-align:center; color:#94a3b8;'>Tuyến này chưa được gán trạm nào cho chiều này. Hãy bấm <b>'Gán Trạm vào Tuyến'</b>.</td></tr>`;
        return;
      }

      tbody.innerHTML = stops.map(st => `
          <tr>
            <td><span class="badge-order">${escapeHtml(st.stop_order)}</span></td>
            <td><b>${escapeHtml(st.stop_id)}</b></td>
            <td style="font-weight: 600; color: #0079c1;">${escapeHtml(st.stop_name)}</td>
            <td>${escapeHtml(st.address || "---")}</td>
            <td>[${st.longitude.toFixed(4)}, ${st.latitude.toFixed(4)}]</td>
            <td>
              <button class="btn btn-sm btn-danger" data-action="removeStopFromRoute" data-route="${escapeHtml(st.route_id)}" data-stop="${escapeHtml(st.stop_id)}" data-dir="${escapeHtml(direction)}" data-order="${escapeHtml(st.stop_order)}" title="Xóa khỏi tuyến này">
                <i class="fa-solid fa-unlink"></i> Bỏ gán
              </button>
            </td>
          </tr>
        `).join("");
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan='6' style='text-align:center; color:red;'>Lỗi tải dữ liệu trạm.</td></tr>`;
  }
}

// Modal tạo/sửa trạm
export function openStopModal(editData = null) {
  document.getElementById("form-stop").reset();
  const title = document.getElementById("modal-stop-title");
  const idInput = document.getElementById("stop_id");
  if (editData) {
    title.innerText = "Cập nhật Trạm dừng";
    idInput.value = editData.properties.stop_id;
    idInput.disabled = true;
    document.getElementById("stop_name").value = editData.properties.stop_name;
    document.getElementById("stop_address").value = editData.properties.address || "";
    document.getElementById("stop_lon").value = editData.geometry.coordinates[0];
    document.getElementById("stop_lat").value = editData.geometry.coordinates[1];
  } else {
    title.innerText = "Thêm Trạm Dừng Mới";
    idInput.disabled = false;
  }
  openModal("modal-stop");
}

export function editStop(id) {
  const item = state.allStops.find(f => f.properties.stop_id === id);
  if (item) openStopModal(item);
}

export async function saveStop(e) {
  e.preventDefault();
  const id = document.getElementById("stop_id").value;
  const isEdit = document.getElementById("stop_id").disabled;
  const payload = {
    stop_id: id,
    stop_name: document.getElementById("stop_name").value,
    address: document.getElementById("stop_address").value,
    longitude: parseFloat(document.getElementById("stop_lon").value),
    latitude: parseFloat(document.getElementById("stop_lat").value)
  };

  try {
    await (isEdit ? updateStop(id, payload) : createStop(payload));
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi lưu trạm"));
    return;
  }
  closeModal("modal-stop");
  loadStops();
}

export async function deleteStop(id) {
  if (!confirm(`Xóa hoàn toàn trạm '${id}' khỏi hệ thống?`)) return;
  await removeStop(id).then(() => loadStops(), ignoreApiError);
}

// Modal Gán trạm vào tuyến
export async function openAssignStopModal() {
  const routeId = document.getElementById("stop_filter_route").value;
  const dir = document.getElementById("stop_filter_dir").value;

  // Nạp danh sách trạm có sẵn
  if (state.allStops.length === 0) {
    const data = await listStops();
    state.allStops = data.features || [];
  }

  const stopSelect = document.getElementById("assign_stop_id");
  stopSelect.innerHTML = state.allStops
    .map(f => `<option value="${escapeHtml(f.properties.stop_id)}">${escapeHtml(f.properties.stop_id)} - ${escapeHtml(f.properties.stop_name)}</option>`)
    .join("");

  // Nạp danh sách tuyến
  const routeSelect = document.getElementById("assign_route_id");
  routeSelect.innerHTML = routeOptionsHtml();
  if (routeId !== "ALL") routeSelect.value = routeId;
  document.getElementById("assign_direction").value = dir;

  openModal("modal-assign-stop");
}

export async function saveAssignStop(e) {
  e.preventDefault();
  const route_id = document.getElementById("assign_route_id").value;
  const stop_id = document.getElementById("assign_stop_id").value;
  const direction = parseInt(document.getElementById("assign_direction").value);
  const stop_order = parseInt(document.getElementById("assign_stop_order").value);

  try {
    await assignStopToRoute(route_id, { stop_id, direction, stop_order });
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi gán trạm"));
    return;
  }
  closeModal("modal-assign-stop");
  loadStops();
}

export async function removeStopFromRoute(route_id, stop_id, direction, stop_order) {
  if (!confirm(`Xóa trạm '${stop_id}' (thứ tự ${stop_order}) khỏi tuyến '${route_id}'?`)) return;
  await unassignStop(route_id, stop_id, direction, stop_order).then(() => loadStops(), ignoreApiError);
}
