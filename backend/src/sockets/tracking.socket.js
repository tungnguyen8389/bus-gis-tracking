const { dbPool } = require("../config/db");

// --------------------------------------------------------------------
// WEBSOCKET REALTIME BROADCAST HUB
// --------------------------------------------------------------------
function registerTrackingSocket(io) {
  io.on("connection", (socket) => {
    // Tiếp nhận gói GPS phát từ simulator
    socket.on("gps_ping", async (gpsData) => {
      // 1. Chuyển tiếp tức thời xuống toàn bộ Map Client đang mở
      io.emit("fleet_location_update", gpsData);

      // 2. Ghi vết lịch sử vào bảng vehicle_tracking_logs (Chạy bất đồng bộ)
      try {
        const wkt = `POINT(${gpsData.longitude} ${gpsData.latitude})`;
        await dbPool.query(
          `INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom)
           VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
          [gpsData.vehicle_id, gpsData.speed_kmh || 0, gpsData.heading || 0, wkt]
        );
      } catch (err) {
        // Bỏ qua lỗi nhẹ nếu log tạm thời không chèn được
      }
    });
  });
}

module.exports = registerTrackingSocket;
