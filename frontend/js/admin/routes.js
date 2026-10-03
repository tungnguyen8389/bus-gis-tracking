// --------------------------------------------------------------------
// QUẢN LÝ TUYẾN XE
// --------------------------------------------------------------------
function routeRowHtml(r) {
  const pathBadge = r.total_paths > 0
    ? '<span class="badge badge-active">Đã có lộ trình</span>'
    : '<span class="badge badge-inactive">Chưa vẽ lộ trình</span>';
  return `
    <tr>
      <td><b>${r.route_id}</b></td>
      <td><span class="badge badge-manager">Tuyến ${r.route_number}</span></td>
      <td>${r.route_name}</td>
      <td>${r.distance_km} km</td>
      <td>${r.headway_min} ph</td>
      <td>${r.total_stops} trạm</td>
      <td>${pathBadge}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="editRoute('${r.route_id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteRoute('${r.route_id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `;
}

async function loadRoutes() {
  try {
    globalRoutes = await apiGetJson("/routes", { auth: true });
    renderTableRows("routes-table-body", globalRoutes, routeRowHtml);
  } catch (e) {}
}

function openRouteModal(editData = null) {
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

function editRoute(id) {
  const item = globalRoutes.find(r => r.route_id === id);
  if (item) openRouteModal(item);
}

async function saveRoute(e) {
  e.preventDefault();
  const idInput = document.getElementById("route_id");
  const payload = {
    route_id: idInput.value,
    route_number: document.getElementById("route_number").value,
    route_name: document.getElementById("route_name").value,
    distance_km: parseFloat(document.getElementById("route_distance").value),
    headway_min: parseInt(document.getElementById("route_headway").value)
  };

  if (await saveResource("/routes", idInput.value, idInput.disabled, payload, "Lỗi lưu tuyến")) {
    closeModal("modal-route");
    loadRoutes();
  }
}

async function deleteRoute(id) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tuyến '${id}'?`)) return;
  const res = await apiRequest("DELETE", `/routes/${id}`);
  if (res.ok) loadRoutes();
}
