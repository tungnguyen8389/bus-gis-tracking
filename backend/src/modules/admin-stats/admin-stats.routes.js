const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./admin-stats.controller");

const router = express.Router();

router.get("/admin/stats", authenticateToken, requireStaff, controller.getStats);

module.exports = router;
