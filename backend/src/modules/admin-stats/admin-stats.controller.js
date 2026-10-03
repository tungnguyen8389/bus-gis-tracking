const { dbPool } = require("../../config/db");

async function getStats(req, res) {
  try {
    const [[{ count_routes }]] = await dbPool.query("SELECT COUNT(*) AS count_routes FROM bus_routes");
    const [[{ count_stops }]] = await dbPool.query("SELECT COUNT(*) AS count_stops FROM bus_stops");
    const [[{ count_vehicles }]] = await dbPool.query("SELECT COUNT(*) AS count_vehicles FROM vehicles");
    const [[{ count_schedules }]] = await dbPool.query("SELECT COUNT(*) AS count_schedules FROM schedules");
    const [[{ count_users }]] = await dbPool.query("SELECT COUNT(*) AS count_users FROM users");
    const [[{ count_logs }]] = await dbPool.query("SELECT COUNT(*) AS count_logs FROM vehicle_tracking_logs");

    res.json({
      routes: count_routes,
      stops: count_stops,
      vehicles: count_vehicles,
      schedules: count_schedules,
      users: count_users,
      tracking_logs: count_logs,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy số liệu thống kê" });
  }
}

module.exports = { getStats };
