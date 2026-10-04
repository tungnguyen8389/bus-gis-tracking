const { dbPool } = require("../../config/db");

// Lấy danh sách tất cả các tuyến kèm số lượng trạm & có lộ trình chưa
async function listRoutes(req, res) {
  try {
    const [rows] = await dbPool.query(`
      SELECT r.*,
             COUNT(DISTINCT rs.stop_id) AS total_stops,
             COUNT(DISTINCT p.path_id) AS total_paths
      FROM bus_routes r
      LEFT JOIN route_stops rs ON r.route_id = rs.route_id
      LEFT JOIN route_paths p ON r.route_id = p.route_id
      GROUP BY r.route_id
      ORDER BY r.route_number ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách tuyến xe" });
  }
}

async function createRoute(req, res) {
  const { route_id, route_number, route_name, distance_km, headway_min } = req.body;
  if (!route_id || !route_number || !route_name) {
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ mã tuyến, số hiệu và tên tuyến" });
  }
  try {
    await dbPool.query(
      "INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)",
      [route_id, route_number, route_name, distance_km || 0, headway_min || 15]
    );
    res.status(201).json({ message: "Thêm tuyến xe thành công", route_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi tạo tuyến xe: " + error.message });
  }
}

async function updateRoute(req, res) {
  const { route_id } = req.params;
  const { route_number, route_name, distance_km, headway_min } = req.body;
  try {
    await dbPool.query(
      "UPDATE bus_routes SET route_number = ?, route_name = ?, distance_km = ?, headway_min = ? WHERE route_id = ?",
      [route_number, route_name, distance_km, headway_min, route_id]
    );
    res.json({ message: "Cập nhật thông tin tuyến thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật tuyến xe" });
  }
}

async function deleteRoute(req, res) {
  const { route_id } = req.params;
  try {
    await dbPool.query("DELETE FROM bus_routes WHERE route_id = ?", [route_id]);
    res.json({ message: "Xóa tuyến xe thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa tuyến xe" });
  }
}

module.exports = { listRoutes, createRoute, updateRoute, deleteRoute };
