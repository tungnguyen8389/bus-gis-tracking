// --------------------------------------------------------------------
// QUẢN LÝ ĐỘI XE BUÝT
// --------------------------------------------------------------------
function vehicleRowHtml(v) {
  const routesDisplay = v.assigned_routes
    ? `<span style="color: #0369a1; font-weight: 600;">${v.assigned_routes}</span> <span class="badge badge-manager">${v.total_trips} chuyến</span>`
    : `<span style="color: #94a3b8; font-style: italic;">Chưa gán chuyến</span>`;

  return `
    <tr>
      <td><b>${v.vehicle_id}</b></td>
      <td><span class="badge badge-manager">${v.plate_number}</span></td>
      <td>${v.capacity} chỗ</td>
      <td>${v.driver_name || "---"}</td>
      <td><span class="badge ${v.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}">${v.status}</span></td>
      <td>${routesDisplay}</td>
      <td>
        <button class="btn btn-sm btn-success" onclick="openScheduleModal(null, '${v.vehicle_id}')" title="Phân công xe vào Chuyến/Tuyến"><i class="fa-solid fa-calendar-plus"></i></button>
        <button class="btn btn-sm btn-primary" onclick="editVehicle('${v.vehicle_id}')" title="Sửa thông tin xe"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteVehicle('${v.vehicle_id}')" title="Xóa xe"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `;
}

async function loadVehicles() {
  try {
    currentVehiclesList = await apiGetJson("/vehicles");
    renderTableRows("vehicles-table-body", currentVehiclesList, vehicleRowHtml);
  } catch (e) {}
}

function openVehicleModal(editData = null) {
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

function editVehicle(id) {
  const item = currentVehiclesList.find(v => v.vehicle_id === id);
  if (item) openVehicleModal(item);
}

async function saveVehicle(e) {
  e.preventDefault();
  const idInput = document.getElementById("vehicle_id");
  const payload = {
    vehicle_id: idInput.value,
    plate_number: document.getElementById("plate_number").value,
    capacity: parseInt(document.getElementById("vehicle_capacity").value),
    driver_name: document.getElementById("driver_name").value,
    status: document.getElementById("vehicle_status").value
  };

  if (await saveResource("/vehicles", idInput.value, idInput.disabled, payload, "Lỗi lưu xe")) {
    closeModal("modal-vehicle");
    loadVehicles();
    loadDashboardStats();
  }
}

async function deleteVehicle(id) {
  if (!confirm(`Xóa xe '${id}'?`)) return;
  const res = await apiRequest("DELETE", `/vehicles/${id}`);
  if (res.ok) {
    loadVehicles();
    loadDashboardStats();
  }
}
