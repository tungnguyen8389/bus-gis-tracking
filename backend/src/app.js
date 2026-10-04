const path = require("path");
const express = require("express");
const cors = require("cors");

const ROOT_DIR = path.join(__dirname, "..", "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Phục vụ giao diện tĩnh cùng cổng với API — chỉ mount đúng 2 thư mục, không mở cả repo (tránh lộ backend/.env)
app.use("/frontend", express.static(path.join(ROOT_DIR, "frontend")));
app.use("/tools", express.static(path.join(ROOT_DIR, "tools")));
app.get("/", (req, res) => res.redirect("/frontend/index.html"));

// Mỗi module tự khai báo đường dẫn con đầy đủ dưới /api/v1
const modules = [
  require("./modules/auth/auth.routes"),
  require("./modules/users/users.routes"),
  require("./modules/bus-routes/bus-routes.routes"),
  require("./modules/paths/paths.routes"),
  require("./modules/stops/stops.routes"),
  require("./modules/trip-plan/trip-plan.routes"),
  require("./modules/vehicles/vehicles.routes"),
  require("./modules/schedules/schedules.routes"),
  require("./modules/admin-stats/admin-stats.routes"),
  require("./modules/import-export/import-export.routes")
];
modules.forEach(router => app.use("/api/v1", router));

module.exports = app;
