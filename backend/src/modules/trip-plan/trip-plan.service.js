const { dbPool } = require("../../config/db");

const TRIP_DEST_RADIUS_M = 300; // Gom các trạm quanh trạm đích (VD: trạm bên kia đường)

// Trạm trong bán kính radiusM quanh (lng, lat): lọc bbox theo ST_X/ST_Y rồi tính khoảng cách cầu.
// Không dùng MBRContains + spatial index: MariaDB 10.4 báo lỗi
// "Update locks cannot be acquired during a READ UNCOMMITTED transaction" khi đọc qua index này.
async function findStopsNear(lng, lat, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const [rows] = await dbPool.query(`
    SELECT stop_id, ST_Distance_Sphere(geom, ST_GeomFromText(?, 4326)) AS distance_m
    FROM bus_stops
    WHERE ST_X(geom) BETWEEN ? AND ? AND ST_Y(geom) BETWEEN ? AND ?
    HAVING distance_m <= ?
  `, [`POINT(${lng} ${lat})`, lng - dLng, lng + dLng, lat - dLat, lat + dLat, radiusM]);
  return new Map(rows.map(r => [r.stop_id, Math.round(r.distance_m)]));
}

module.exports = { TRIP_DEST_RADIUS_M, findStopsNear };
