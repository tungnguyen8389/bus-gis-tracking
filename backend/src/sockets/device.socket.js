const { validateGpsPing } = require("./gps.validate");
const { createDeviceAuth } = require("./device.auth");

const MIN_PING_INTERVAL_MS = 250;   // Simulator 500ms, điện thoại 1s; chừa độ trễ dao động qua tunnel
const WARN_INTERVAL_MS = 10000;

// --------------------------------------------------------------------
// NAMESPACE /device: thiết bị của tài xế (điện thoại hoặc simulator) phát GPS.
// Danh tính xe lấy từ phiên đã xác thực; client chỉ gửi vị trí.
// --------------------------------------------------------------------
function registerDeviceSocket(io, { db, jwtSecret, broadcaster, trackingLog, registry, now = Date.now }) {
  const devices = io.of("/device");
  const activeDevices = new Map(); // vehicle_id → socket đang giữ xe (mỗi xe 1 phiên)
  // vehicle_id → schedule_id đang chạy. Theo XE, không theo phiên: phiên bị thay thì handler
  // disconnect của phiên cũ thoát sớm, nên chuyến phải được kết thúc từ đây.
  const liveTrips = new Map();

  const endLiveTrip = vehicleId => {
    const scheduleId = liveTrips.get(vehicleId);
    if (scheduleId === undefined) return;
    liveTrips.delete(vehicleId);
    registry.end(scheduleId);
    broadcaster.publishOffline({ vehicle_id: vehicleId, schedule_id: scheduleId });
  };

  devices.use(createDeviceAuth({ db, jwtSecret }));

  devices.on("connection", socket => {
    const { vehicle } = socket.data;

    // Phiên mới thay phiên cũ của cùng xe (vd. điện thoại tài xế thay simulator)
    const previous = activeDevices.get(vehicle.vehicle_id);
    activeDevices.set(vehicle.vehicle_id, socket);
    if (previous) {
      previous.emit("session:replaced");
      previous.disconnect(true);
    }

    socket.on("trip:start", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const [rows] = await db.query(
          `SELECT s.schedule_id, s.route_id, s.vehicle_id, s.direction, r.route_number
           FROM schedules s
           JOIN bus_routes r ON r.route_id = s.route_id
           WHERE s.schedule_id = ?`,
          [payload?.schedule_id]
        );
        const schedule = rows[0];
        if (!schedule || schedule.vehicle_id !== vehicle.vehicle_id) {
          return reply({ ok: false, error: "SCHEDULE_NOT_ALLOWED" });
        }
        // Phiên bị thay trong lúc chờ DB → không được ghi đè chuyến của phiên mới
        if (activeDevices.get(vehicle.vehicle_id) !== socket) {
          return reply({ ok: false, error: "SESSION_REPLACED" });
        }

        if (liveTrips.has(vehicle.vehicle_id) && liveTrips.get(vehicle.vehicle_id) !== schedule.schedule_id) {
          endLiveTrip(vehicle.vehicle_id);
        }
        socket.data.trip = {
          schedule_id: schedule.schedule_id,
          route_id: schedule.route_id,
          route_number: schedule.route_number,
          direction: schedule.direction
        };
        registry.start({
          schedule_id: schedule.schedule_id,
          vehicle_id: vehicle.vehicle_id,
          route_id: schedule.route_id,
          direction: schedule.direction
        });
        liveTrips.set(vehicle.vehicle_id, schedule.schedule_id);
        reply({ ok: true, trip: socket.data.trip });
      } catch (err) {
        console.error("[device] trip:start lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("gps_ping", raw => {
      const { trip } = socket.data;
      if (!trip) return;

      const t = now();
      if (t - socket.data.lastPingAt < MIN_PING_INTERVAL_MS) return;

      const result = validateGpsPing(raw);
      if (!result.ok) {
        if (t - socket.data.lastWarnAt >= WARN_INTERVAL_MS) {
          socket.data.lastWarnAt = t;
          console.warn(`[device] Bỏ gói GPS của xe ${vehicle.vehicle_id}: ${result.reason}`);
        }
        return;
      }
      socket.data.lastPingAt = t;

      const packet = {
        vehicle_id: vehicle.vehicle_id,
        plate_number: vehicle.plate_number,
        schedule_id: trip.schedule_id,
        route_id: trip.route_id,
        route_number: trip.route_number,
        direction: trip.direction,
        ...result.value,
        timestamp: new Date(t).toISOString()
      };
      broadcaster.publishLocation(packet);
      registry.recordPing(trip.schedule_id, result.value);
      trackingLog.record(packet);
    });

    socket.on("trip:end", (...args) => {
      const ack = args.find(a => typeof a === "function") || (() => {});
      // Phiên thay thế có thể chưa có trip nhưng xe vẫn đang chạy chuyến của phiên cũ
      socket.data.trip = null;
      endLiveTrip(vehicle.vehicle_id);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      // Phiên đã bị thay thì xe vẫn đang chạy ở phiên mới → không kết thúc chuyến
      if (activeDevices.get(vehicle.vehicle_id) !== socket) return;
      activeDevices.delete(vehicle.vehicle_id);
      endLiveTrip(vehicle.vehicle_id);
    });
  });
}

module.exports = { registerDeviceSocket };
