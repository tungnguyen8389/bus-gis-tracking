const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./paths.controller");

const router = express.Router();

router.get("/paths", controller.listPaths);
router.get("/routes/:route_id/path", controller.getRoutePath);
router.post("/routes/:route_id/path", authenticateToken, requireStaff, controller.saveRoutePath);

module.exports = router;
