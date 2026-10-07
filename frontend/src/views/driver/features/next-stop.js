// Trạm kế tiếp phía trước xe trên lộ trình [lon, lat] — hàm thuần (không DOM/ArcGIS), test bằng node --test
const M_PER_DEG_LAT = 111320;
const ARRIVAL_TOLERANCE_M = 10; // Xe trong 10 m quanh trạm coi như đã tới trạm đó

// Chiếu p lên đoạn a-b, hiệu chỉnh kinh độ theo cos(vĩ độ) như path-clip.js
function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * Math.PI / 180);
  const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (((p[0] - a[0]) * kx) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = (p[0] - (a[0] + (b[0] - a[0]) * t)) * kx;
  const ey = p[1] - (a[1] + (b[1] - a[1]) * t);
  return { t, dist2: ex * ex + ey * ey };
}

function segmentLengthMeters(a, b) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]) * M_PER_DEG_LAT;
}

// Quãng đường (mét) từ đầu tuyến tới điểm chiếu gần nhất của point trên lộ trình
export function distanceAlongPath(coords, point) {
  let along = 0;
  let best = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const segLen = segmentLengthMeters(coords[i], coords[i + 1]);
    const pr = projectOnSegment(point, coords[i], coords[i + 1]);
    if (!best || pr.dist2 < best.dist2) best = { dist2: pr.dist2, along: along + pr.t * segLen };
    along += segLen;
  }
  return best ? best.along : 0;
}

// Trạm đầu tiên (theo stop_order) nằm phía trước xe; null khi đã qua trạm cuối hoặc thiếu dữ liệu
export function nextStop(position, pathCoords, stops) {
  if (!pathCoords || pathCoords.length < 2 || !stops || stops.length === 0) return null;
  const busAlong = distanceAlongPath(pathCoords, position);
  const ahead = stops
    .map(stop => ({ stop, along: distanceAlongPath(pathCoords, [stop.longitude, stop.latitude]) }))
    .filter(s => s.along > busAlong + ARRIVAL_TOLERANCE_M)
    .sort((x, y) => x.stop.stop_order - y.stop.stop_order)[0];
  return ahead ? { stop: ahead.stop, distanceMeters: ahead.along - busAlong } : null;
}
