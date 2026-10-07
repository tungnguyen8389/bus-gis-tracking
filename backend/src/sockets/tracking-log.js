// Ghi vết hành trình vào vehicle_tracking_logs: tối đa 1 bản ghi / xe / intervalMs
// (realtime vẫn phát mọi gói). Lỗi DB được log có giới hạn thay vì nuốt im lặng.
function createTrackingLog(db, { intervalMs = 5000, errorIntervalMs = 30000, now = Date.now, logError = console.error } = {}) {
  const lastLoggedAt = new Map();
  const lastErrorAt = new Map();

  async function record(packet) {
    const t = now();
    const id = packet.vehicle_id;
    if (t - (lastLoggedAt.get(id) ?? -Infinity) < intervalMs) return false;
    lastLoggedAt.set(id, t);

    try {
      await db.query(
        `INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom)
         VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
        [id, packet.speed_kmh, packet.heading, `POINT(${packet.longitude} ${packet.latitude})`]
      );
      return true;
    } catch (err) {
      if (t - (lastErrorAt.get(id) ?? -Infinity) >= errorIntervalMs) {
        lastErrorAt.set(id, t);
        logError(`[tracking-log] Không ghi được log xe ${id}:`, err.message);
      }
      return false;
    }
  }

  return { record };
}

module.exports = { createTrackingLog };
