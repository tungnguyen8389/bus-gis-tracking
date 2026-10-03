const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./admin-stats.controller");

const router = express.Router();

router.get("/admin/stats", authenticateToken, controller.getStats);

module.exports = router;
