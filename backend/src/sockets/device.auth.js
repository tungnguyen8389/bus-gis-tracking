const jwt = require("jsonwebtoken");

// Handshake namespace /device: JWT của tài xế (role DRIVER) + tài xế đang được gán xe.
// Lỗi trả về client qua connect_error với message UNAUTHORIZED | NO_VEHICLE | SERVER_ERROR.
function createDeviceAuth({ db, jwtSecret }) {
  return async (socket, next) => {
    let user;
    try {
      user = jwt.verify(socket.handshake.auth?.token || "", jwtSecret);
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
    if (user.role !== "DRIVER") return next(new Error("UNAUTHORIZED"));

    try {
      const [rows] = await db.query(
        "SELECT vehicle_id, plate_number FROM vehicles WHERE driver_user_id = ?",
        [user.user_id]
      );
      if (rows.length === 0) return next(new Error("NO_VEHICLE"));
      socket.data = { user, vehicle: rows[0], trip: null, lastPingAt: 0, lastWarnAt: 0 };
      next();
    } catch (err) {
      console.error("[device] Lỗi tra xe của tài xế:", err.message);
      next(new Error("SERVER_ERROR"));
    }
  };
}

module.exports = { createDeviceAuth };
