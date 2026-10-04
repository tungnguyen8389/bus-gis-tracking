const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./import-export.controller");

const router = express.Router();

router.post("/import/json", authenticateToken, requireStaff, controller.importJson);
router.get("/export/json", authenticateToken, requireStaff, controller.exportJson);

module.exports = router;
