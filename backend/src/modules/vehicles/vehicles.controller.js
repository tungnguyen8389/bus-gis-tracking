const { dbPool } = require("../../config/db");

async function listVehicles(req, res) {
  try {
    const [rows] = await dbPool.query(`
      SELECT v.*,
             GROUP_CONCAT(DISTINCT CONCAT('Tuyến ', r.route_number, ' - ', r.route_name) SEPARATOR ', ') AS assigned_routes,
             COUNT(s.schedule_id) AS total_trips
      FROM vehicles v
      LEFT JOIN schedules s ON v.vehicle_id = s.vehicle_id
      LEFT JOIN bus_routes r ON s.route_id = r.route_id
      GROUP BY v.vehicle_id
      ORDER BY v.vehicle_id ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách phương tiện" });
  }
}

async function createVehicle(req, res) {
  const { vehicle_id, plate_number, capacity, driver_name, status } = req.body;
  if (!vehicle_id || !plate_number) {
    return res.status(400).json({ error: "Vui lòng nhập Mã xe và Biển số xe" });
  }
  try {
    await dbPool.query(
      "INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES (?, ?, ?, ?, ?)",
      [vehicle_id, plate_number, capacity || 40, driver_name || "", status || "ACTIVE"]
    );
    res.status(201).json({ message: "Thêm phương tiện thành công", vehicle_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm phương tiện: " + error.message });
  }
}

async function updateVehicle(req, res) {
  const { vehicle_id } = req.params;
  const { plate_number, capacity, driver_name, status } = req.body;
  try {
    await dbPool.query(
      "UPDATE vehicles SET plate_number = ?, capacity = ?, driver_name = ?, status = ? WHERE vehicle_id = ?",
      [plate_number, capacity, driver_name, status, vehicle_id]
    );
    res.json({ message: "Cập nhật phương tiện thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật phương tiện" });
  }
}

async function deleteVehicle(req, res) {
  const { vehicle_id } = req.params;
  try {
    await dbPool.query("DELETE FROM vehicles WHERE vehicle_id = ?", [vehicle_id]);
    res.json({ message: "Xóa phương tiện thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa phương tiện" });
  }
}

module.exports = { listVehicles, createVehicle, updateVehicle, deleteVehicle };
