// --------------------------------------------------------------------
// QUẢN LÝ TRẠM DỪNG THEO TUYẾN & CHIỀU
// --------------------------------------------------------------------
const ALL_STOPS_TABLE_HEADER = `
  <th>Mã trạm</th>
  <th>Tên trạm dừng</th>
  <th>Địa chỉ / Vị trí</th>
  <th>Kinh độ (Lon)</th>
  <th>Vĩ độ (Lat)</th>
  <th>Thao tác</th>
`;

const ROUTE_STOPS_TABLE_HEADER = `
  <th style="width: 70px;">Thứ tự</th>
  <th>Mã trạm</th>
  <th>Tên trạm dừng</th>
  <th>Địa chỉ</th>
  <th>Tọa độ [Lon, Lat]</th>
  <th>Thao tác</th>
`;

async function loadRoutesForFilter() {
  try {
    await ensureRoutesLoaded();
    const select = document.getElementById("stop_filter_route");
    const currentVal = select.value;
    fillRouteSelect(select, `<option value="ALL">🌐 Tất cả các trạm trong hệ thống</option>`);
    if (currentVal) select.value = currentVal;
  } catch (e) {}
}

function onStopFilterChanged() {
  const isAll = document.getElementById("stop_filter_route").value === "ALL";
  document.getElementById("stop_filter_dir_group").style.display = isAll ? "none" : "flex";
  document.getElementById("btnAssignStop").style.display = isAll ? "none" : "inline-flex";
  loadStops();
}

function stopFeatureRowHtml(f) {
  const p = f.properties;
  const coords = f.geometry.coordinates;
  return `
    <tr>
      <td><b>${p.stop_id}</b></td>
      <td>${p.stop_name}</td>
      <td>${p.address || "---"}</td>
      <td>${coords[0].toFixed(6)}</td>
      <td>${coords[1].toFixed(6)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="editStop('${p.stop_id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteStop('${p.stop_id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `;
}

function routeStopRowHtml(st, direction) {
  return `
    <tr>
      <td><span class="badge-order">${st.stop_order}</span></td>
      <td><b>${st.stop_id}</b></td>
      <td style="font-weight: 600; color: #0079c1;">${st.stop_name}</td>
      <td>${st.address || "---"}</td>
      <td>[${st.longitude.toFixed(4)}, ${st.latitude.toFixed(4)}]</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="removeStopFromRoute('${st.route_id}', '${st.stop_id}', ${direction}, ${st.stop_order})" title="Xóa khỏi tuyến này">
          <i class="fa-solid fa-unlink"></i> Bỏ gán
        </button>
      </td>
    </tr>
  `;
}

async function loadStops() {
  const routeId = document.getElementById("stop_filter_route").value;
  const direction = document.getElementById("stop_filter_dir").value;
  const header = document.getElementById("stops-table-header");
  const tbody = document.getElementById("stops-table-body");
  tbody.innerHTML = tableMessageRow(6, "Đang tải...");

  try {
    if (routeId === "ALL") {
      // Hiển thị toàn bộ trạm trong hệ thống
      header.innerHTML = ALL_STOPS_TABLE_HEADER;
      const data = await apiGetJson("/stops");
      globalAllStops = data.features || [];
      tbody.innerHTML = globalAllStops.map(stopFeatureRowHtml).join("");
    } else {
      // Hiển thị trạm thuộc tuyến & chiều được chọn
      header.innerHTML = ROUTE_STOPS_TABLE_HEADER;
      const stops = await apiGetJson(`/routes/${routeId}/stops?direction=${direction}`);

      if (stops.length === 0) {
        tbody.innerHTML = tableMessageRow(6, "Tuyến này chưa được gán trạm nào cho chiều này. Hãy bấm <b>'Gán Trạm vào Tuyến'</b>.", " color:#94a3b8;");
        return;
      }
      tbody.innerHTML = stops.map(st => routeStopRowHtml(st, direction)).join("");
    }
  } catch (e) {
    tbody.innerHTML = tableMessageRow(6, "Lỗi tải dữ liệu trạm.", " color:red;");
  }
}

// Modal tạo/sửa trạm
function openStopModal(editData = null) {
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

function editStop(id) {
  const item = globalAllStops.find(f => f.properties.stop_id === id);
  if (item) openStopModal(item);
}

async function saveStop(e) {
  e.preventDefault();
  const idInput = document.getElementById("stop_id");
  const payload = {
    stop_id: idInput.value,
    stop_name: document.getElementById("stop_name").value,
    address: document.getElementById("stop_address").value,
    longitude: parseFloat(document.getElementById("stop_lon").value),
    latitude: parseFloat(document.getElementById("stop_lat").value)
  };

  if (await saveResource("/stops", idInput.value, idInput.disabled, payload, "Lỗi lưu trạm")) {
    closeModal("modal-stop");
    loadStops();
  }
}

async function deleteStop(id) {
  if (!confirm(`Xóa hoàn toàn trạm '${id}' khỏi hệ thống?`)) return;
  const res = await apiRequest("DELETE", `/stops/${id}`);
  if (res.ok) loadStops();
}

// Modal Gán trạm vào tuyến
async function openAssignStopModal() {
  const routeId = document.getElementById("stop_filter_route").value;
  const dir = document.getElementById("stop_filter_dir").value;

  // Nạp danh sách trạm có sẵn
  await ensureAllStopsLoaded();
  document.getElementById("assign_stop_id").innerHTML = globalAllStops
    .map(f => `<option value="${f.properties.stop_id}">${f.properties.stop_id} - ${f.properties.stop_name}</option>`)
    .join("");

  // Nạp danh sách tuyến
  const routeSelect = document.getElementById("assign_route_id");
  fillRouteSelect(routeSelect);
  if (routeId !== "ALL") routeSelect.value = routeId;
  document.getElementById("assign_direction").value = dir;

  openModal("modal-assign-stop");
}

async function saveAssignStop(e) {
  e.preventDefault();
  const route_id = document.getElementById("assign_route_id").value;
  const stop_id = document.getElementById("assign_stop_id").value;
  const direction = parseInt(document.getElementById("assign_direction").value);
  const stop_order = parseInt(document.getElementById("assign_stop_order").value);

  const res = await apiRequest("POST", `/routes/${route_id}/stops`, { stop_id, direction, stop_order });
  if (res.ok) {
    closeModal("modal-assign-stop");
    loadStops();
  } else {
    const err = await res.json();
    alert(err.error || "Lỗi gán trạm");
  }
}

async function removeStopFromRoute(route_id, stop_id, direction, stop_order) {
  if (!confirm(`Xóa trạm '${stop_id}' khỏi tuyến '${route_id}'?`)) return;
  const res = await apiRequest("DELETE", `/routes/${route_id}/stops/${stop_id}?direction=${direction}&stop_order=${stop_order}`);
  if (res.ok) loadStops();
}
