const jwt = require("jsonwebtoken");
const { isPublicTrip } = require("./eta");

const PUSH_INTERVAL_MS = 15000;
const STAFF_ROLES = new Set(["ADMIN", "MANAGER"]);

const tripRoom = scheduleId => `trip:${scheduleId}`;
const vehicleRoom = vehicleId => `vehicle:${vehicleId}`;
const routeRoom = (routeId, direction) => `route:${routeId}:${direction}`;

// Vị trí xe chỉ tới: khách đang theo dõi chuyến, tài xế của xe, nhân viên
function createViewerBroadcaster(io) {
  const viewers = io.of("/");
  const rooms = ({ vehicle_id, schedule_id }) => [tripRoom(schedule_id), vehicleRoom(vehicle_id), "staff"];
  return {
    publishLocation: packet => viewers.to(rooms(packet)).emit("fleet_location_update", packet),
    publishOffline: ({ vehicle_id, schedule_id }) =>
      viewers.to(rooms({ vehicle_id, schedule_id })).emit("vehicle_offline", { vehicle_id, schedule_id })
  };
}

// Handshake "/": token nhân viên → room staff; token tài xế → room xe của mình.
// Không token / token sai / hết hạn → khách, KHÔNG báo lỗi (trang công khai hay còn token cũ).
function createViewerAuth({ db, jwtSecret }) {
  return async (socket, next) => {
    socket.data = { tripRoom: null, routeRoom: null, subscription: null };
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    let user;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch {
      return next();
    }
    if (STAFF_ROLES.has(user.role)) {
      socket.data.staff = true;
    } else if (user.role === "DRIVER") {
      try {
        const [rows] = await db.query("SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?", [user.user_id]);
        if (rows[0]) socket.data.driverVehicleId = rows[0].vehicle_id;
      } catch (err) {
        console.error("[viewer] Lỗi tra xe của tài xế:", err.message);
      }
    }
    next();
  };
}

function parseSubscription(payload) {
  const rawRoute = payload?.route_id;
  const route_id = typeof rawRoute === "string" || typeof rawRoute === "number" ? String(rawRoute) : "";
  const direction = Number(payload?.direction);
  if (!route_id || route_id.length > 20 || (direction !== 1 && direction !== 2)) return null;
  const board = payload.board_stop_id;
  const board_stop_id = typeof board === "string" && board.length > 0 && board.length <= 20 ? board : null;
  return { route_id, direction, board_stop_id };
}

// --------------------------------------------------------------------
// NAMESPACE "/": bản đồ công khai, nhân viên, trang tài xế.
// Khách: trips:subscribe (danh sách chuyến + ETA, không tọa độ) và trip:watch (tọa độ của đúng 1 chuyến).
// --------------------------------------------------------------------
function registerViewerSocket(io, { db, jwtSecret, registry, tripLister, now = Date.now, pushIntervalMs = PUSH_INTERVAL_MS }) {
  const viewers = io.of("/");
  const routeTargets = new Map(); // tên room tuyến → { route_id, direction }

  viewers.use(createViewerAuth({ db, jwtSecret }));

  const leave = (socket, key) => {
    if (socket.data[key]) socket.leave(socket.data[key]);
    socket.data[key] = null;
  };

  // Tính danh sách 1 lần cho mỗi trạm lên khác nhau trong room, gửi riêng từng socket
  async function pushRoom(room) {
    const target = routeTargets.get(room);
    const ids = viewers.adapter.rooms.get(room);
    if (!target || !ids || ids.size === 0) {
      routeTargets.delete(room);
      return;
    }
    const byStop = new Map();
    for (const id of ids) {
      const socket = viewers.sockets.get(id);
      if (!socket) continue;
      const stopId = socket.data.subscription?.board_stop_id || "";
      if (!byStop.has(stopId)) byStop.set(stopId, []);
      byStop.get(stopId).push(socket);
    }
    for (const [stopId, sockets] of byStop) {
      const trips = await tripLister.list({ ...target, board_stop_id: stopId || null });
      sockets.forEach(s => {
        if (s.data.routeRoom === room) s.emit("trips:update", { ...target, trips });
      });
    }
  }
  const safePush = room =>
    pushRoom(room).catch(err => console.error("[viewer] Lỗi đẩy danh sách chuyến:", err.message));

  // Chuyến bắt đầu/kết thúc → đẩy cả 2 chiều (vận tốc cho chuyến sắp tới tính trên cả tuyến)
  registry.on("change", ({ route_id }) => {
    [1, 2].forEach(direction => {
      const room = routeRoom(route_id, direction);
      if (routeTargets.has(room)) safePush(room);
    });
  });
  const timer = setInterval(() => routeTargets.forEach((_, room) => safePush(room)), pushIntervalMs);
  timer.unref();

  viewers.on("connection", socket => {
    if (socket.data.staff) socket.join("staff");
    if (socket.data.driverVehicleId) socket.join(vehicleRoom(socket.data.driverVehicleId));

    socket.on("trips:subscribe", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const sub = parseSubscription(payload);
      if (!sub) return reply({ ok: false, error: "BAD_REQUEST" });

      leave(socket, "routeRoom");
      const room = routeRoom(sub.route_id, sub.direction);
      socket.join(room);
      routeTargets.set(room, { route_id: sub.route_id, direction: sub.direction });
      socket.data.routeRoom = room;
      socket.data.subscription = sub;
      try {
        reply({ ok: true, trips: await tripLister.list(sub) });
      } catch (err) {
        console.error("[viewer] trips:subscribe lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("trips:unsubscribe", () => {
      leave(socket, "routeRoom");
      socket.data.subscription = null;
    });

    socket.on("trip:watch", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const scheduleId = Number(payload?.schedule_id);
      if (!Number.isInteger(scheduleId) || scheduleId <= 0) return reply({ ok: false, error: "TRIP_NOT_AVAILABLE" });
      try {
        const [rows] = await db.query(
          "SELECT schedule_id, TIME_TO_SEC(departure_time) AS dep_sec FROM schedules WHERE schedule_id = ?",
          [scheduleId]
        );
        const running = registry.has(scheduleId);
        if (!rows[0] || !isPublicTrip(Number(rows[0].dep_sec), now(), running)) {
          return reply({ ok: false, error: "TRIP_NOT_AVAILABLE" });
        }
        leave(socket, "tripRoom");
        socket.data.tripRoom = tripRoom(scheduleId);
        socket.join(socket.data.tripRoom);
        reply({ ok: true, status: running ? "RUNNING" : "UPCOMING" });
      } catch (err) {
        console.error("[viewer] trip:watch lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("trip:unwatch", () => leave(socket, "tripRoom"));
  });

  return { stop: () => clearInterval(timer) };
}

module.exports = { createViewerBroadcaster, registerViewerSocket };
