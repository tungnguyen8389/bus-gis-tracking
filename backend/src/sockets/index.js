const { dbPool } = require("../config/db");
const { JWT_SECRET } = require("../config/env");
const { createViewerBroadcaster } = require("./viewer.socket");
const { registerDeviceSocket } = require("./device.socket");
const { createTrackingLog } = require("./tracking-log");

// Hub realtime: "/" (viewer, chỉ nhận) + "/device" (tài xế đã xác thực, phát GPS)
function registerSockets(io) {
  registerDeviceSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: createTrackingLog(dbPool)
  });
}

module.exports = { registerSockets };
