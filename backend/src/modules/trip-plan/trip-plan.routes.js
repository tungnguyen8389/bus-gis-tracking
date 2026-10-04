const express = require("express");
const controller = require("./trip-plan.controller");

const router = express.Router();

router.get("/trip-plan", controller.planTrip);

module.exports = router;
