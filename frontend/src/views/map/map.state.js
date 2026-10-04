// Trạng thái dùng chung giữa các feature của trang bản đồ.
// Luôn đọc/ghi qua thuộc tính (state.x = ...) — biến export không gán lại được từ module khác.
export const state = {
  allRoutes: [],
  currentRawStops: [],          // Trạm đang hiển thị (tuyến đang chọn hoặc toàn hệ thống)
  currentSelectedRoute: "ALL",
  currentDirection: 1,
  userPosition: null,           // { latitude, longitude, accuracy, time }
  selectedTrackedVehicleId: null,
  busGraphics: {}               // vehicle_id → Graphic xe buýt trên fleetLayer
};

// Đối tượng ArcGIS, gán khi bản đồ khởi tạo xong (null trước đó)
export const map = {
  view: null,
  Graphic: null,
  Point: null,
  routeLayer: null,
  stopsLayer: null,
  fleetLayer: null,
  tripLayer: null
};
