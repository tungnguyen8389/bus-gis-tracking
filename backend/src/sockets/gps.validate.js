// Kiểm tra gói gps_ping từ thiết bị. Chỉ giữ 4 trường vị trí;
// vehicle_id/route/timestamp do server tự điền từ phiên đã xác thực.
const isNum = v => typeof v === "number" && Number.isFinite(v);

function validateGpsPing(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "NOT_OBJECT" };

  const { latitude, longitude } = raw;
  if (!isNum(latitude) || latitude < -90 || latitude > 90) return { ok: false, reason: "BAD_LATITUDE" };
  if (!isNum(longitude) || longitude < -180 || longitude > 180) return { ok: false, reason: "BAD_LONGITUDE" };

  const speed = raw.speed_kmh ?? 0;
  if (!isNum(speed) || speed < 0 || speed > 200) return { ok: false, reason: "BAD_SPEED" };

  const heading = raw.heading ?? 0;
  if (!isNum(heading) || heading < 0 || heading >= 360) return { ok: false, reason: "BAD_HEADING" };

  return { ok: true, value: { latitude, longitude, speed_kmh: speed, heading } };
}

module.exports = { validateGpsPing };
