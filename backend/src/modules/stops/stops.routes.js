const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./stops.controller");

const router = express.Router();

router.get("/stops", controller.listStops);
router.post("/stops", authenticateToken, requireStaff, controller.createStop);
router.put("/stops/:stop_id", authenticateToken, requireStaff, controller.updateStop);
router.delete("/stops/:stop_id", authenticateToken, requireStaff, controller.deleteStop);

// Trạm thuộc tuyến
router.get("/routes/:route_id/stops", controller.listRouteStops);
router.post("/routes/:route_id/stops", authenticateToken, requireStaff, controller.assignStopToRoute);
router.delete("/routes/:route_id/stops/:stop_id", authenticateToken, requireStaff, controller.removeStopFromRoute);

module.exports = router;
