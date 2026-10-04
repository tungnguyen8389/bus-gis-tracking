const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./auth.controller");

const router = express.Router();

router.post("/auth/login", controller.login);
router.get("/auth/me", authenticateToken, controller.me);

module.exports = router;
