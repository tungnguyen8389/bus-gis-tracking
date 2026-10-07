const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./bus-routes.controller");

const router = express.Router();

router.get("/routes", controller.listRoutes);
router.post("/routes", authenticateToken, requireStaff, controller.createRoute);
router.put("/routes/:route_id", authenticateToken, requireStaff, controller.updateRoute);
router.delete("/routes/:route_id", authenticateToken, requireStaff, controller.deleteRoute);

module.exports = router;
