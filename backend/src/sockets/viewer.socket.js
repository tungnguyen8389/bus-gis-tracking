// Namespace "/" cho bản đồ công khai & trang tài xế: chỉ NHẬN dữ liệu.
// Server không lắng nghe sự kiện nào từ viewer → viewer không thể phát vị trí giả.
function createViewerBroadcaster(io) {
  const viewers = io.of("/");
  return {
    publishLocation: packet => viewers.emit("fleet_location_update", packet),
    publishOffline: vehicleId => viewers.emit("vehicle_offline", { vehicle_id: vehicleId })
  };
}

module.exports = { createViewerBroadcaster };
