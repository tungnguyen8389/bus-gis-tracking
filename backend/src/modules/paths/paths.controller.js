const { dbPool } = require("../../config/db");

// Lấy toàn bộ lộ trình tim đường của tất cả các tuyến (GeoJSON FeatureCollection)
async function listPaths(req, res) {
  try {
    const [rows] = await dbPool.query(
      `SELECT p.path_id, p.route_id, p.direction, r.route_number, r.route_name,
              ST_AsGeoJSON(p.geom) AS geom_json
       FROM route_paths p
       JOIN bus_routes r ON p.route_id = r.route_id
       ORDER BY p.route_id ASC, p.direction ASC`
    );

    const geojson = {
      type: "FeatureCollection",
      features: rows.map(row => ({
        type: "Feature",
        geometry: JSON.parse(row.geom_json),
        properties: {
          path_id: row.path_id,
          route_id: row.route_id,
          route_number: row.route_number,
          route_name: row.route_name,
          direction: row.direction
        }
      }))
    };
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ error: "Lỗi truy vấn toàn bộ lộ trình tim đường" });
  }
}

// Lấy lộ trình tim đường (Polyline) theo route_id dạng GeoJSON
async function getRoutePath(req, res) {
  const { route_id } = req.params;
  const direction = req.query.direction || 1;
  try {
    const [rows] = await dbPool.query(
      `SELECT p.path_id, p.route_id, p.direction, r.route_number, r.route_name,
              ST_AsGeoJSON(p.geom) AS geom_json
       FROM route_paths p
       JOIN bus_routes r ON p.route_id = r.route_id
       WHERE p.route_id = ? AND p.direction = ? LIMIT 1`,
      [route_id, direction]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy lộ trình tim đường của tuyến này" });
    }

    const row = rows[0];
    const geojson = {
      type: "Feature",
      geometry: JSON.parse(row.geom_json),
      properties: {
        path_id: row.path_id,
        route_id: row.route_id,
        route_number: row.route_number,
        route_name: row.route_name,
        direction: row.direction
      }
    };
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ error: "Lỗi truy vấn lộ trình tim đường" });
  }
}

// Cập nhật hoặc thêm mới lộ trình tim đường (Coordinates: [[lon, lat], ...])
async function saveRoutePath(req, res) {
  const { route_id } = req.params;
  const { direction, coordinates } = req.body; // coordinates: [[lon, lat], [lon, lat], ...]

  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(400).json({ error: "Lộ trình cần tối thiểu 2 điểm tọa độ hợp lệ dạng [[lon, lat], ...]" });
  }

  try {
    // Chuyển mảng tọa độ thành chuỗi WKT LINESTRING
    const lineStringWkt = `LINESTRING(${coordinates.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;
    const dir = direction ? parseInt(direction) : 1;

    // Xóa lộ trình cũ của chiều này nếu có
    await dbPool.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [route_id, dir]);

    // Thêm lộ trình mới
    await dbPool.query(
      "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
      [route_id, dir, lineStringWkt]
    );

    res.status(201).json({
      message: "Cập nhật lộ trình tọa độ thành công",
      route_id,
      direction: dir,
      points_count: coordinates.length
    });
  } catch (error) {
    console.error("Lỗi lưu lộ trình:", error);
    res.status(500).json({ error: "Lỗi lưu lộ trình vào CSDL: " + error.message });
  }
}

module.exports = { listPaths, getRoutePath, saveRoutePath };
