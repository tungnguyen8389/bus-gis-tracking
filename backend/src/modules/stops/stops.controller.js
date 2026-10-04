const { dbPool } = require("../../config/db");

// Lấy toàn bộ danh sách trạm dừng dạng GeoJSON FeatureCollection
async function listStops(req, res) {
  try {
    const [rows] = await dbPool.query(
      `SELECT stop_id, stop_name, address, ST_AsGeoJSON(geom) AS geom_json FROM bus_stops`
    );

    const geojson = {
      type: "FeatureCollection",
      features: rows.map(row => {
        const geom = JSON.parse(row.geom_json);
        return {
          type: "Feature",
          geometry: geom,
          properties: {
            stop_id: row.stop_id,
            stop_name: row.stop_name,
            address: row.address,
            longitude: geom.coordinates[0],
            latitude: geom.coordinates[1]
          }
        };
      })
    };
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách trạm dừng" });
  }
}

// Thêm mới trạm xe buýt
async function createStop(req, res) {
  const { stop_id, stop_name, address, longitude, latitude } = req.body;
  if (!stop_id || !stop_name || longitude === undefined || latitude === undefined) {
    return res.status(400).json({ error: "Thiếu tham số dữ liệu trạm bắt buộc (Mã, Tên, Kinh độ, Vĩ độ)" });
  }

  try {
    const wktPoint = `POINT(${longitude} ${latitude})`;
    await dbPool.query(
      `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
       VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
      [stop_id, stop_name, address || "", wktPoint]
    );
    res.status(201).json({ message: "Thêm trạm thành công", stop_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm trạm: " + error.message });
  }
}

// Cập nhật trạm xe buýt
async function updateStop(req, res) {
  const { stop_id } = req.params;
  const { stop_name, address, longitude, latitude } = req.body;

  try {
    if (longitude !== undefined && latitude !== undefined) {
      const wktPoint = `POINT(${longitude} ${latitude})`;
      await dbPool.query(
        `UPDATE bus_stops
         SET stop_name = ?, address = ?, geom = ST_GeomFromText(?, 4326)
         WHERE stop_id = ?`,
        [stop_name, address || "", wktPoint, stop_id]
      );
    } else {
      await dbPool.query(
        `UPDATE bus_stops SET stop_name = ?, address = ? WHERE stop_id = ?`,
        [stop_name, address || "", stop_id]
      );
    }
    res.json({ message: "Cập nhật trạm dừng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật trạm" });
  }
}

// Xóa trạm dừng
async function deleteStop(req, res) {
  const { stop_id } = req.params;
  try {
    await dbPool.query("DELETE FROM bus_stops WHERE stop_id = ?", [stop_id]);
    res.json({ message: "Xóa trạm dừng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa trạm dừng" });
  }
}

// Lấy danh sách trạm thuộc tuyến đường theo thứ tự
async function listRouteStops(req, res) {
  const { route_id } = req.params;
  const direction = req.query.direction || 1;
  try {
    const [rows] = await dbPool.query(`
      SELECT rs.route_id, rs.stop_id, rs.direction, rs.stop_order,
             s.stop_name, s.address, ST_AsGeoJSON(s.geom) AS geom_json
      FROM route_stops rs
      JOIN bus_stops s ON rs.stop_id = s.stop_id
      WHERE rs.route_id = ? AND rs.direction = ?
      ORDER BY rs.stop_order ASC
    `, [route_id, direction]);

    const stops = rows.map(r => {
      const geom = JSON.parse(r.geom_json);
      return {
        ...r,
        longitude: geom.coordinates[0],
        latitude: geom.coordinates[1]
      };
    });
    res.json(stops);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách trạm trên tuyến" });
  }
}

// Gán trạm dừng vào tuyến
async function assignStopToRoute(req, res) {
  const { route_id } = req.params;
  const { stop_id, direction, stop_order } = req.body;
  if (!stop_id || !direction || stop_order === undefined) {
    return res.status(400).json({ error: "Thiếu thông tin gán trạm" });
  }
  try {
    // Khóa chính (route_id, direction, stop_order): vị trí đã có trạm thì thay bằng trạm mới
    await dbPool.query(
      `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
      [route_id, stop_id, direction, stop_order]
    );
    res.status(201).json({ message: "Gán trạm vào tuyến thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi gán trạm: " + error.message });
  }
}

// Xóa trạm khỏi tuyến (?stop_order=N: chỉ xóa lần ghé tại vị trí đó — tuyến vòng có thể ghé 1 trạm nhiều lần)
async function removeStopFromRoute(req, res) {
  const { route_id, stop_id } = req.params;
  const direction = req.query.direction || 1;
  const { stop_order } = req.query;
  try {
    if (stop_order !== undefined) {
      await dbPool.query(
        "DELETE FROM route_stops WHERE route_id = ? AND stop_id = ? AND direction = ? AND stop_order = ?",
        [route_id, stop_id, direction, stop_order]
      );
    } else {
      await dbPool.query(
        "DELETE FROM route_stops WHERE route_id = ? AND stop_id = ? AND direction = ?",
        [route_id, stop_id, direction]
      );
    }
    res.json({ message: "Đã xóa trạm khỏi tuyến" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa trạm khỏi tuyến" });
  }
}

module.exports = {
  listStops,
  createStop,
  updateStop,
  deleteStop,
  listRouteStops,
  assignStopToRoute,
  removeStopFromRoute
};
