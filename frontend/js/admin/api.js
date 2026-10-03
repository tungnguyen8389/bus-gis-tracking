// --------------------------------------------------------------------
// GỌI API QUẢN TRỊ (kèm token bus_admin_token)
// --------------------------------------------------------------------
function getAuthHeaders() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

// Gửi request có xác thực; body (nếu có) được serialize JSON
function apiRequest(method, path, body) {
  const options = { method, headers: getAuthHeaders() };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${API_BASE}${path}`, options);
}

// GET JSON — mặc định không gửi token (các endpoint đọc công khai)
async function apiGetJson(path, { auth = false } = {}) {
  const res = await fetch(`${API_BASE}${path}`, auth ? { headers: getAuthHeaders() } : undefined);
  return res.json();
}

// Tạo mới (POST collectionPath) hoặc cập nhật (PUT collectionPath/id).
// Trả về true nếu thành công, ngược lại alert lỗi từ server.
async function saveResource(collectionPath, id, isEdit, payload, errorFallback) {
  const res = isEdit
    ? await apiRequest("PUT", `${collectionPath}/${id}`, payload)
    : await apiRequest("POST", collectionPath, payload);
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || errorFallback);
  }
  return res.ok;
}

// --------------------------------------------------------------------
// BỘ NHỚ ĐỆM DỮ LIỆU DÙNG CHUNG GIỮA CÁC TAB
// --------------------------------------------------------------------
let globalRoutes = [];
let currentVehiclesList = [];

async function ensureRoutesLoaded() {
  if (globalRoutes.length === 0) {
    globalRoutes = await apiGetJson("/routes");
  }
  return globalRoutes;
}

async function ensureVehiclesLoaded() {
  if (currentVehiclesList.length === 0) {
    currentVehiclesList = await apiGetJson("/vehicles");
  }
  return currentVehiclesList;
}

// Đổ danh sách tuyến vào <select>; firstOptionHtml là option "Tất cả" (nếu có)
function fillRouteSelect(select, firstOptionHtml = "") {
  select.innerHTML = firstOptionHtml + routeOptionsHtml(globalRoutes);
}
