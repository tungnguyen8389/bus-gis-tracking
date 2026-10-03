const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./bus-routes.controller");

const router = express.Router();

router.get("/routes", controller.listRoutes);
router.post("/routes", authenticateToken, controller.createRoute);
router.put("/routes/:route_id", authenticateToken, controller.updateRoute);
router.delete("/routes/:route_id", authenticateToken, controller.deleteRoute);

module.exports = router;
