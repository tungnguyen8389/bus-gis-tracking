const { dbPool } = require("../config/db");
const { JWT_SECRET } = require("../config/env");
const { createViewerBroadcaster, registerViewerSocket } = require("./viewer.socket");
const { registerDeviceSocket } = require("./device.socket");
const { createTrackingLog } = require("./tracking-log");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

// Hub realtime: "/" (bản đồ, nhân viên, trang tài xế — nhận theo room) + "/device" (tài xế đã xác thực, phát GPS)
function registerSockets(io) {
  const registry = createTripRegistry();
  registerDeviceSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: createTrackingLog(dbPool),
    registry
  });
  registerViewerSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    registry,
    tripLister: createTripLister({ db: dbPool, registry })
  });
}

module.exports = { registerSockets };
