// --------------------------------------------------------------------
// DANH SÁCH CHUYẾN CHO KHÁCH: chuyến đang chạy + sắp tới của 1 tuyến/chiều, kèm ETA tới trạm lên.
// Không chứa tọa độ — tọa độ chỉ đi qua room trip:<schedule_id>.
// --------------------------------------------------------------------
const { buildLine, stopProgress, project } = require("./route-geometry");
const { isPublicTrip, vnMidnightMs, vehicleSpeedKmh, averageSpeedKmh, tripEta } = require("./eta");

const parseGeo = v => (typeof v === "string" ? JSON.parse(v) : v);

async function loadGeometry(db, routeId, direction) {
  const [paths] = await db.query(
    "SELECT ST_AsGeoJSON(geom) AS geom_json FROM route_paths WHERE route_id = ? AND direction = ? LIMIT 1",
    [routeId, direction]
  );
  if (paths.length === 0) return null;
  const geom = parseGeo(paths[0].geom_json);
  const coords = geom.type === "MultiLineString" ? geom.coordinates.flat() : geom.coordinates;
  const line = buildLine(coords);
  if (!line) return null;

  const [stops] = await db.query(
    `SELECT rs.stop_id, ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude
     FROM route_stops rs
     JOIN bus_stops s ON s.stop_id = rs.stop_id
     WHERE rs.route_id = ? AND rs.direction = ?
     ORDER BY rs.stop_order ASC`,
    [routeId, direction]
  );
  return { line, stops: stopProgress(line, stops) };
}

function createTripLister({ db, registry, now = Date.now }) {
  const cache = new Map(); // "route|dir" → Promise<{ line, stops }>

  function geometry(routeId, direction) {
    const key = `${routeId}|${direction}`;
    if (!cache.has(key)) {
      cache.set(key, loadGeometry(db, routeId, direction).then(geo => {
        // Không cache null result (lộ trình chưa có, thử lại lần sau)
        if (geo === null) {
          cache.delete(key);
        }
        return geo;
      }).catch(err => {
        cache.delete(key);
        throw err;
      }));
    }
    return cache.get(key);
  }

  async function list({ route_id, direction, board_stop_id }) {
    const nowMs = now();
    const [rows] = await db.query(
      `SELECT s.schedule_id, TIME_TO_SEC(s.departure_time) AS dep_sec,
              TIME_FORMAT(s.departure_time, '%H:%i') AS departure_time,
              v.plate_number, v.driver_name
       FROM schedules s
       JOIN vehicles v ON v.vehicle_id = s.vehicle_id
       WHERE s.route_id = ? AND s.direction = ?
       ORDER BY s.departure_time ASC`,
      [route_id, direction]
    );
    const visible = rows.filter(r => isPublicTrip(Number(r.dep_sec), nowMs, registry.has(r.schedule_id)));
    if (visible.length === 0) return [];

    const geo = await geometry(route_id, direction);
    const boardM = geo && board_stop_id ? geo.stops.get(board_stop_id) : undefined;

    // Vận tốc từng xe đang chạy của tuyến (cả 2 chiều) → trung bình làm vận tốc cho chuyến sắp tới
    const speeds = new Map();
    for (const trip of registry.listByRoute(route_id)) {
      let tripGeo = null;
      try {
        tripGeo = await geometry(trip.route_id, trip.direction);
      } catch {
        // Lỗi nạp hình học của chiều khác không làm fail list, dùng fallback speed
      }
      speeds.set(trip.schedule_id, vehicleSpeedKmh(trip, tripGeo ? tripGeo.line : null));
    }
    const routeSpeed = averageSpeedKmh([...speeds.values()]);
    const midnight = vnMidnightMs(nowMs);

    const trips = visible.map(r => {
      const depSec = Number(r.dep_sec);
      const running = registry.get(r.schedule_id);
      const pos = running && running.last_position;
      const vehicleM = pos && geo ? project(geo.line, [pos.longitude, pos.latitude]) : 0;
      const { status, etaMs } = tripEta({
        running: !!running, depSec, nowMs, boardM, vehicleM,
        speedKmh: running ? speeds.get(r.schedule_id) : routeSpeed
      });
      return {
        sortKey: etaMs ?? midnight + depSec * 1000,
        trip: {
          schedule_id: r.schedule_id,
          departure_time: r.departure_time,
          plate_number: r.plate_number,
          driver_name: r.driver_name,
          status,
          eta_board: etaMs === null ? null : new Date(etaMs).toISOString(),
          minutes_to_board: etaMs === null ? null : Math.max(0, Math.round((etaMs - nowMs) / 60000))
        }
      };
    });

    return trips
      .sort((a, b) => (a.trip.status === "PASSED") - (b.trip.status === "PASSED") || a.sortKey - b.sortKey)
      .map(x => x.trip);
  }

  return { list };
}

module.exports = { createTripLister };
