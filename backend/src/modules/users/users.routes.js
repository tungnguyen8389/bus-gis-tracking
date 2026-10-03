const express = require("express");
const { authenticateToken, requireAdmin } = require("../../middleware/auth");
const controller = require("./users.controller");

const router = express.Router();

router.get("/users", authenticateToken, controller.listUsers);
router.post("/users", authenticateToken, requireAdmin, controller.createUser);
router.put("/users/:id", authenticateToken, requireAdmin, controller.updateUser);
router.delete("/users/:id", authenticateToken, requireAdmin, controller.deleteUser);

module.exports = router;
