// --------------------------------------------------------------------
// QUẢN LÝ TRẠM DỪNG THEO TUYẾN & CHIỀU
// --------------------------------------------------------------------
const ALL_STOPS_TABLE_HEADER = `
  <th>Mã trạm</th>
  <th>Tên trạm dừng</th>
  <th>Loại / Trạng thái</th>
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
  document.getElementById("stop_search_group").style.display = isAll ? "flex" : "none";
  document.getElementById("btnAssignStop").style.display = isAll ? "none" : "inline-flex";
  stopsPage = 1;
  loadStops();
}

// Phân trang & tìm kiếm ở chế độ "Tất cả các trạm" (gọi server, không tải toàn bộ ~6.000 trạm)
const STOPS_PAGE_SIZE = 50;
let stopsPage = 1;
let stopsTotal = 0;
let currentStopsPage = [];

const onStopSearchInput = debounce(() => {
  stopsPage = 1;
  loadStops();
}, 300);

function changeStopsPage(delta) {
  const totalPages = Math.max(Math.ceil(stopsTotal / STOPS_PAGE_SIZE), 1);
  const next = stopsPage + delta;
  if (next < 1 || next > totalPages) return;
  stopsPage = next;
  loadStops();
}

function renderStopsPager(isVisible) {
  document.getElementById("stops-pager").style.display = isVisible ? "flex" : "none";
  if (!isVisible) return;
  const totalPages = Math.max(Math.ceil(stopsTotal / STOPS_PAGE_SIZE), 1);
  const from = stopsTotal === 0 ? 0 : (stopsPage - 1) * STOPS_PAGE_SIZE + 1;
  const to = Math.min(stopsPage * STOPS_PAGE_SIZE, stopsTotal);
  document.getElementById("stops-pager-info").innerText = `Hiển thị ${from}–${to} / ${stopsTotal} trạm · Trang ${stopsPage}/${totalPages}`;
  document.getElementById("stops-pager-prev").disabled = stopsPage <= 1;
  document.getElementById("stops-pager-next").disabled = stopsPage >= totalPages;
}

function stopStatusBadgeHtml(p) {
  const isActive = !p.status || p.status === STOP_STATUS_ACTIVE;
  return `<div style="font-size: 12px; color: #64748b;">${p.stop_type || "---"}</div>` +
    `<span class="badge ${isActive ? "badge-active" : "badge-inactive"}">${p.status || STOP_STATUS_ACTIVE}</span>`;
}

function stopFeatureRowHtml(f) {
  const p = f.properties;
  const coords = f.geometry.coordinates;
  return `
    <tr>
      <td><b>${p.stop_code || p.stop_id}</b><div style="font-size: 11px; color: #94a3b8;">ID ${p.stop_id}</div></td>
      <td>${p.stop_name}</td>
      <td>${stopStatusBadgeHtml(p)}</td>
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
  tbody.innerHTML = tableMessageRow(7, "Đang tải...");
  renderStopsPager(false);

  try {
    if (routeId === "ALL") {
      // Hiển thị trạm trong hệ thống theo trang (có tìm kiếm)
      header.innerHTML = ALL_STOPS_TABLE_HEADER;
      const keyword = document.getElementById("stop_search").value.trim();
      const data = await apiGetJson(`/stops?page=${stopsPage}&limit=${STOPS_PAGE_SIZE}&q=${encodeURIComponent(keyword)}`);
      currentStopsPage = data.features || [];
      stopsTotal = data.total || 0;
      tbody.innerHTML = currentStopsPage.length
        ? currentStopsPage.map(stopFeatureRowHtml).join("")
        : tableMessageRow(7, "Không tìm thấy trạm phù hợp.", " color:#94a3b8;");
      renderStopsPager(true);
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
    tbody.innerHTML = tableMessageRow(7, "Lỗi tải dữ liệu trạm.", " color:red;");
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
  const item = currentStopsPage.find(f => f.properties.stop_id === id);
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

  // Nạp danh sách trạm có sẵn (lọc qua ô tìm kiếm, tối đa STOPS_SEARCH_LIMIT kết quả)
  document.getElementById("assign_stop_search").value = "";
  await loadAssignStopOptions("");

  // Nạp danh sách tuyến
  const routeSelect = document.getElementById("assign_route_id");
  fillRouteSelect(routeSelect);
  if (routeId !== "ALL") routeSelect.value = routeId;
  document.getElementById("assign_direction").value = dir;

  openModal("modal-assign-stop");
}

async function loadAssignStopOptions(keyword) {
  const select = document.getElementById("assign_stop_id");
  try {
    const data = await apiGetJson(`/stops?limit=${STOPS_SEARCH_LIMIT}&q=${encodeURIComponent(keyword)}`);
    const features = data.features || [];
    select.innerHTML = features.length
      ? features.map(f => `<option value="${f.properties.stop_id}">${f.properties.stop_code || f.properties.stop_id} - ${f.properties.stop_name}</option>`).join("")
      : `<option value="">Không tìm thấy trạm phù hợp</option>`;
  } catch (e) {
    select.innerHTML = `<option value="">Lỗi tải danh sách trạm</option>`;
  }
}

const onAssignStopSearchInput = debounce(() => {
  loadAssignStopOptions(document.getElementById("assign_stop_search").value.trim());
}, 300);

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
