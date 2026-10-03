// --------------------------------------------------------------------
// PHÂN CÔNG CHUYẾN & XE (Schedules & Trip Assignments)
// --------------------------------------------------------------------
let currentSchedulesList = [];

const DEFAULT_DEPARTURE_TIME = "06:30";

// Giữ lựa chọn hiện tại của <select> sau khi nạp lại danh sách option
function refillSelectKeepingValue(select, html) {
  const current = select.value;
  select.innerHTML = html;
  if (current) select.value = current;
}

async function loadScheduleFilterDropdowns() {
  try {
    await ensureRoutesLoaded();
    refillSelectKeepingValue(
      document.getElementById("schedule_filter_route"),
      `<option value="ALL">🌐 Tất cả các tuyến</option>` + routeOptionsHtml(globalRoutes)
    );

    await ensureVehiclesLoaded();
    refillSelectKeepingValue(
      document.getElementById("schedule_filter_vehicle"),
      `<option value="ALL">Tất cả xe buýt</option>` +
        currentVehiclesList.map(v => `<option value="${v.vehicle_id}">${v.plate_number} (${v.vehicle_id})</option>`).join("")
    );
  } catch (e) {}
}

function scheduleRowHtml(s) {
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
        <button class="btn btn-sm btn-primary" onclick="editSchedule(${s.schedule_id})" title="Sửa chuyến"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteSchedule(${s.schedule_id})" title="Hủy phân công"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `;
}

async function loadSchedules() {
  const filters = {
    route_id: document.getElementById("schedule_filter_route").value,
    direction: document.getElementById("schedule_filter_dir").value,
    vehicle_id: document.getElementById("schedule_filter_vehicle").value
  };
  const tbody = document.getElementById("schedules-table-body");
  tbody.innerHTML = tableMessageRow(8, "Đang tải danh sách phân công chuyến...");

  try {
    let query = "";
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "ALL") query += `${key}=${encodeURIComponent(value)}&`;
    });

    currentSchedulesList = await apiGetJson(`/schedules?${query}`);

    if (currentSchedulesList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">Chưa có chuyến xe nào được phân công phù hợp với bộ lọc. Hãy bấm <b>"Phân Công Chuyến Mới"</b> để gán xe vào tuyến!</td></tr>`;
      return;
    }
    tbody.innerHTML = currentSchedulesList.map(scheduleRowHtml).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
  }
}

async function populateModalScheduleDropdowns(selectedRouteId = null, selectedVehicleId = null) {
  await ensureRoutesLoaded();
  const routeSelect = document.getElementById("modal_schedule_route_id");
  fillRouteSelect(routeSelect);
  if (selectedRouteId) routeSelect.value = selectedRouteId;

  await ensureVehiclesLoaded();
  const vehSelect = document.getElementById("modal_schedule_vehicle_id");
  vehSelect.innerHTML = currentVehiclesList
    .map(v => `<option value="${v.vehicle_id}">${v.plate_number} - Tài xế: ${v.driver_name || 'Chưa gán'} (${v.status})</option>`)
    .join("");
  if (selectedVehicleId) vehSelect.value = selectedVehicleId;
}

async function openScheduleModal(editData = null, preVehicleId = null, preRouteId = null) {
  document.getElementById("form-schedule").reset();
  await populateModalScheduleDropdowns(
    editData ? editData.route_id : preRouteId,
    editData ? editData.vehicle_id : preVehicleId
  );

  const idInput = document.getElementById("edit_schedule_id");
  const title = document.getElementById("modal-schedule-title");
  const timeInput = document.getElementById("modal_schedule_departure_time");

  if (editData) {
    title.innerText = "Cập Nhật Phân Công Chuyến Xe";
    idInput.value = editData.schedule_id;
    document.getElementById("modal_schedule_direction").value = editData.direction;
    timeInput.value = editData.departure_time ? editData.departure_time.substring(0, 5) : DEFAULT_DEPARTURE_TIME;
  } else {
    title.innerText = "Phân Công Xe Vào Chuyến Mới";
    idInput.value = "";
    timeInput.value = DEFAULT_DEPARTURE_TIME;
  }
  openModal("modal-schedule");
}

function editSchedule(id) {
  const item = currentSchedulesList.find(s => s.schedule_id === id);
  if (item) openScheduleModal(item);
}

// Sau khi thay đổi phân công: làm mới bảng chuyến, bảng xe và thống kê
function refreshAfterScheduleChange() {
  loadSchedules();
  loadVehicles();
  loadDashboardStats();
}

async function saveSchedule(e) {
  e.preventDefault();
  const schedId = document.getElementById("edit_schedule_id").value;
  const payload = {
    route_id: document.getElementById("modal_schedule_route_id").value,
    direction: parseInt(document.getElementById("modal_schedule_direction").value),
    vehicle_id: document.getElementById("modal_schedule_vehicle_id").value,
    departure_time: document.getElementById("modal_schedule_departure_time").value + ":00"
  };

  try {
    const res = schedId
      ? await apiRequest("PUT", `/schedules/${schedId}`, payload)
      : await apiRequest("POST", "/schedules", payload);

    if (res.ok) {
      closeModal("modal-schedule");
      refreshAfterScheduleChange();
    } else {
      const err = await res.json();
      alert("Lỗi: " + (err.error || "Không thể lưu phân công chuyến"));
    }
  } catch (err) {
    alert("Lỗi kết nối: " + err.message);
  }
}

async function deleteSchedule(id) {
  if (!confirm(`Hủy phân công chuyến xe #SCH_${id}?`)) return;
  try {
    const res = await apiRequest("DELETE", `/schedules/${id}`);
    if (res.ok) {
      refreshAfterScheduleChange();
    } else {
      const err = await res.json();
      alert("Lỗi xóa chuyến: " + err.error);
    }
  } catch (err) {
    alert("Lỗi kết nối: " + err.message);
  }
}

function resetScheduleFilters() {
  ["schedule_filter_route", "schedule_filter_dir", "schedule_filter_vehicle"].forEach(id => {
    document.getElementById(id).value = "ALL";
  });
  loadSchedules();
}
