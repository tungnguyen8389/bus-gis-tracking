const { dbPool } = require("../../config/db");

async function listSchedules(req, res) {
  const { route_id, vehicle_id, direction } = req.query;
  try {
    let query = `
      SELECT s.schedule_id, s.route_id, s.vehicle_id, s.departure_time, s.direction,
             r.route_number, r.route_name, r.headway_min,
             v.plate_number, v.driver_name, v.capacity, v.status AS vehicle_status
      FROM schedules s
      JOIN bus_routes r ON s.route_id = r.route_id
      JOIN vehicles v ON s.vehicle_id = v.vehicle_id
      WHERE 1=1
    `;
    const params = [];
    if (route_id) {
      query += " AND s.route_id = ?";
      params.push(route_id);
    }
    if (vehicle_id) {
      query += " AND s.vehicle_id = ?";
      params.push(vehicle_id);
    }
    if (direction) {
      query += " AND s.direction = ?";
      params.push(direction);
    }
    query += " ORDER BY s.route_id ASC, s.direction ASC, s.departure_time ASC";

    const [rows] = await dbPool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách phân công chuyến: " + error.message });
  }
}

async function createSchedule(req, res) {
  const { route_id, vehicle_id, departure_time, direction } = req.body;
  if (!route_id || !vehicle_id || !departure_time) {
    return res.status(400).json({ error: "Vui lòng chọn Tuyến xe, Phương tiện và Giờ xuất bến" });
  }
  try {
    const [result] = await dbPool.query(
      "INSERT INTO schedules (route_id, vehicle_id, departure_time, direction) VALUES (?, ?, ?, ?)",
      [route_id, vehicle_id, departure_time, direction ? parseInt(direction) : 1]
    );
    res.status(201).json({ message: "Phân công chuyến xe thành công", schedule_id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: "Lỗi phân công chuyến: " + error.message });
  }
}

async function updateSchedule(req, res) {
  const { id } = req.params;
  const { route_id, vehicle_id, departure_time, direction } = req.body;
  if (!route_id || !vehicle_id || !departure_time) {
    return res.status(400).json({ error: "Thiếu thông tin cập nhật chuyến" });
  }
  try {
    await dbPool.query(
      "UPDATE schedules SET route_id = ?, vehicle_id = ?, departure_time = ?, direction = ? WHERE schedule_id = ?",
      [route_id, vehicle_id, departure_time, direction ? parseInt(direction) : 1, id]
    );
    res.json({ message: "Cập nhật chuyến xe thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật chuyến: " + error.message });
  }
}

async function deleteSchedule(req, res) {
  const { id } = req.params;
  try {
    await dbPool.query("DELETE FROM schedules WHERE schedule_id = ?", [id]);
    res.json({ message: "Đã hủy phân công chuyến xe" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa chuyến: " + error.message });
  }
}

module.exports = { listSchedules, createSchedule, updateSchedule, deleteSchedule };
