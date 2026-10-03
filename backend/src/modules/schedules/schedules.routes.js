const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./schedules.controller");

const router = express.Router();

router.get("/schedules", controller.listSchedules);
router.post("/schedules", authenticateToken, controller.createSchedule);
router.put("/schedules/:id", authenticateToken, controller.updateSchedule);
router.delete("/schedules/:id", authenticateToken, controller.deleteSchedule);

module.exports = router;
