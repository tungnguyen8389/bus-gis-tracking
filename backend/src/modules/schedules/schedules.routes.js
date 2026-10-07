const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./schedules.controller");

const router = express.Router();

router.get("/schedules", controller.listSchedules);
router.post("/schedules", authenticateToken, requireStaff, controller.createSchedule);
router.put("/schedules/:id", authenticateToken, requireStaff, controller.updateSchedule);
router.delete("/schedules/:id", authenticateToken, requireStaff, controller.deleteSchedule);

module.exports = router;
