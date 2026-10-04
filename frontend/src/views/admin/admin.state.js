// Dữ liệu dùng chung giữa các tab trang quản trị (đọc/ghi qua thuộc tính: state.routes = ...)
export const state = {
  currentUser: null,
  routes: [],        // Danh sách tuyến (bảng Tuyến xe + dropdown các tab khác)
  allStops: [],      // GeoJSON features toàn bộ trạm
  vehicles: [],
  schedules: [],
  users: []
};

// Bản đồ xem trước JSON (gán khi ArcGIS nạp xong)
export const preview = {
  view: null,
  layer: null,
  Graphic: null
};
