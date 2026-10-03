// --------------------------------------------------------------------
// MODAL & CHUYỂN ĐỔI TAB
// --------------------------------------------------------------------
function openModal(id) { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

// Tiêu đề trang & hàm nạp dữ liệu tương ứng với từng tab
const ADMIN_TABS = {
  "dashboard": { title: "Tổng quan Hệ thống", load: () => loadDashboardStats() },
  "routes": { title: "Quản lý Tuyến xe & Lộ trình (GIS)", load: () => loadRoutes() },
  "stops": { title: "Quản lý Trạm Dừng theo Tuyến & Chiều", load: () => { loadRoutesForFilter(); loadStops(); } },
  "vehicles": { title: "Quản lý Đội xe Buýt", load: () => loadVehicles() },
  "schedules": { title: "Phân Công Chuyến Xe & Lịch Trình Khởi Hành", load: () => { loadScheduleFilterDropdowns(); loadSchedules(); } },
  "json-hub": {
    title: "Nhập / Xuất Dữ liệu JSON & Tọa độ",
    load: () => { loadRoutesForImport(); setTimeout(() => previewView && previewView.container && previewView.resize(), 200); }
  },
  "users": { title: "Quản lý Người dùng & Phân quyền", load: () => loadUsers() }
};

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(el => el.classList.remove("active"));

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) targetPane.classList.add("active");

  const tab = ADMIN_TABS[tabId];
  document.getElementById("page-title").innerText = tab ? tab.title : "Quản trị";
  if (tab) tab.load();
}

// Render các hàng của bảng. Xóa bảng trước để nếu API trả lỗi (list không phải mảng)
// thì bảng trống thay vì giữ dữ liệu cũ.
function renderTableRows(tbodyId, list, rowHtml) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = "";
  tbody.innerHTML = list.map(rowHtml).join("");
}

// Hàng thông báo chiếm toàn bộ chiều rộng bảng (đang tải, rỗng, lỗi)
function tableMessageRow(colspan, html, style = "") {
  return `<tr><td colspan='${colspan}' style='text-align:center;${style}'>${html}</td></tr>`;
}
