const { dbPool } = require("../../config/db");
const { TRIP_DEST_RADIUS_M, findStopsNear } = require("./trip-plan.service");

// --------------------------------------------------------------------
// TÌM TUYẾN CHO KHÁCH: TỪ VỊ TRÍ GPS ĐẾN TRẠM ĐÍCH (CHỈ TUYẾN ĐI THẲNG)
// --------------------------------------------------------------------
async function planTrip(req, res) {
  const { to_stop_id, from_lat, from_lng } = req.query;
  if (!to_stop_id) {
    return res.status(400).json({ error: "Vui lòng chọn trạm điểm đến (to_stop_id)" });
  }

  const hasOrigin = from_lat !== undefined || from_lng !== undefined;
  const originLat = Number(from_lat);
  const originLng = Number(from_lng);
  if (hasOrigin && !(Number.isFinite(originLat) && Number.isFinite(originLng) &&
      Math.abs(originLat) <= 90 && Math.abs(originLng) <= 180)) {
    return res.status(400).json({ error: "Tọa độ vị trí hiện tại không hợp lệ" });
  }

  try {
    const [destRows] = await dbPool.query(
      "SELECT stop_id, stop_name, address, ST_X(geom) AS longitude, ST_Y(geom) AS latitude FROM bus_stops WHERE stop_id = ?",
      [to_stop_id]
    );
    if (destRows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy trạm điểm đến" });
    }
    const destination = destRows[0];

    const destStops = await findStopsNear(destination.longitude, destination.latitude, TRIP_DEST_RADIUS_M);
    destStops.set(destination.stop_id, 0);
    const destIds = [...destStops.keys()];

    // Mỗi tuyến + chiều chỉ giữ một phương án tốt nhất
    const best = new Map();
    const keep = (key, option, isBetter) => {
      const current = best.get(key);
      if (!current || isBetter(option, current)) best.set(key, option);
    };

    if (hasOrigin) {
      // Không giới hạn bán kính: với mỗi tuyến + chiều đi qua trạm đích, chọn trạm lên gần khách nhất
      // nằm trước trạm xuống trên cùng chiều chạy
      const [pairs] = await dbPool.query(`
        SELECT o.route_id, o.direction, o.stop_id AS board_id, o.stop_order AS board_order,
               d.stop_id AS alight_id, d.stop_order AS alight_order,
               ST_Distance_Sphere(s.geom, ST_GeomFromText(?, 4326)) AS board_walk
        FROM route_stops d
        JOIN route_stops o
          ON o.route_id = d.route_id AND o.direction = d.direction AND o.stop_order < d.stop_order
        JOIN bus_stops s ON s.stop_id = o.stop_id
        WHERE d.stop_id IN (?)
      `, [`POINT(${originLng} ${originLat})`, destIds]);

      pairs.forEach(p => {
        const option = {
          ...p,
          board_walk: Math.round(p.board_walk),
          walk: destStops.get(p.alight_id),
          num_stops: p.alight_order - p.board_order
        };
        keep(`${p.route_id}|${p.direction}`, option, (a, b) =>
          (a.board_walk - b.board_walk || a.walk - b.walk || a.num_stops - b.num_stops) < 0);
      });
    } else {
      const [rows] = await dbPool.query(
        "SELECT route_id, direction, stop_id AS alight_id, stop_order AS alight_order FROM route_stops WHERE stop_id IN (?)",
        [destIds]
      );
      rows.forEach(r => {
        keep(`${r.route_id}|${r.direction}`, { ...r, walk: destStops.get(r.alight_id) },
          (a, b) => a.walk < b.walk);
      });
    }

    const options = [...best.values()];
    if (options.length === 0) {
      return res.json({ destination, has_origin: hasOrigin, results: [] });
    }

    const routeIds = [...new Set(options.map(o => o.route_id))];
    const stopIds = [...new Set(options.flatMap(o => [o.alight_id, o.board_id].filter(Boolean)))];
    const [routeRows] = await dbPool.query(
      "SELECT route_id, route_number, route_name FROM bus_routes WHERE route_id IN (?)", [routeIds]
    );
    const [stopRows] = await dbPool.query(
      "SELECT stop_id, stop_name, address, ST_X(geom) AS longitude, ST_Y(geom) AS latitude FROM bus_stops WHERE stop_id IN (?)", [stopIds]
    );
    const routesById = new Map(routeRows.map(r => [String(r.route_id), r]));
    const stopsById = new Map(stopRows.map(s => [s.stop_id, s]));

    const results = options
      .filter(o => routesById.has(String(o.route_id)))
      .map(o => {
        const route = routesById.get(String(o.route_id));
        return {
          route_id: o.route_id,
          route_number: route.route_number,
          route_name: route.route_name,
          direction: o.direction,
          board_stop: o.board_id
            ? { ...stopsById.get(o.board_id), stop_order: o.board_order, walk_m: o.board_walk }
            : null,
          alight_stop: { ...stopsById.get(o.alight_id), stop_order: o.alight_order, walk_m: o.walk },
          num_stops: o.num_stops ?? null
        };
      })
      // Có GPS: tuyến có trạm lên gần khách nhất xếp trước; không GPS: theo số tuyến
      .sort((a, b) => hasOrigin
        ? a.board_stop.walk_m - b.board_stop.walk_m || a.alight_stop.walk_m - b.alight_stop.walk_m || a.num_stops - b.num_stops
        : String(a.route_number).localeCompare(String(b.route_number), "vi", { numeric: true }) || a.direction - b.direction);

    res.json({ destination, has_origin: hasOrigin, results });
  } catch (error) {
    console.error("Lỗi tìm tuyến:", error);
    res.status(500).json({ error: "Lỗi tìm tuyến xe buýt" });
  }
}

module.exports = { planTrip };
