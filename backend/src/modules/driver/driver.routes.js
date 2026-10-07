const express = require("express");
const { authenticateToken, requireRole } = require("../../middleware/auth");
const controller = require("./driver.controller");

const router = express.Router();

router.post("/auth/driver/login", controller.login);
router.get("/driver/me", authenticateToken, requireRole("DRIVER"), controller.me);

module.exports = router;
