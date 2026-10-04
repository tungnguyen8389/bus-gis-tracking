const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const controller = require("./vehicles.controller");

const router = express.Router();

router.get("/vehicles", controller.listVehicles);
router.post("/vehicles", authenticateToken, controller.createVehicle);
router.put("/vehicles/:vehicle_id", authenticateToken, controller.updateVehicle);
router.delete("/vehicles/:vehicle_id", authenticateToken, controller.deleteVehicle);

module.exports = router;
