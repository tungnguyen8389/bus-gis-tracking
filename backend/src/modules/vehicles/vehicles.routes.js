const express = require("express");
const { authenticateToken, requireStaff } = require("../../middleware/auth");
const controller = require("./vehicles.controller");

const router = express.Router();

router.get("/vehicles", controller.listVehicles);
router.post("/vehicles", authenticateToken, requireStaff, controller.createVehicle);
router.put("/vehicles/:vehicle_id", authenticateToken, requireStaff, controller.updateVehicle);
router.delete("/vehicles/:vehicle_id", authenticateToken, requireStaff, controller.deleteVehicle);

module.exports = router;
