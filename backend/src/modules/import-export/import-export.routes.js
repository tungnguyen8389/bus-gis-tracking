const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./import-export.controller");

const router = express.Router();

router.post("/import/json", authenticateToken, controller.importJson);
router.get("/export/json", authenticateToken, controller.exportJson);

module.exports = router;
