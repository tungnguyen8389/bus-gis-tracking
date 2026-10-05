// --------------------------------------------------------------------
// HÌNH HỌC LỘ TRÌNH: quãng đường (mét) dọc polyline, dùng để tính ETA.
// Hàm thuần, không đụng DB. Tọa độ dạng [longitude, latitude].
// --------------------------------------------------------------------
const EARTH_R = 6371000;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQUATOR = 111320;
const toRad = d => (d * Math.PI) / 180;

function haversineM([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// cum[i] = quãng đường từ đầu tuyến tới điểm i; < 2 điểm hợp lệ → null
function buildLine(coords) {
  const pts = (coords || []).filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
  return { coords: pts, cum, total: cum[cum.length - 1] };
}

// Chiếu điểm lên polyline (xấp xỉ phẳng cục bộ), chỉ xét phần từ fromM trở đi.
// Trả về quãng đường từ đầu tuyến tới hình chiếu gần nhất.
function project(line, [lon, lat], fromM = 0) {
  const kx = Math.cos(toRad(lat)) * M_PER_DEG_LON_EQUATOR;
  const ky = M_PER_DEG_LAT;
  let bestD2 = Infinity;
  let bestM = Math.min(fromM, line.total);

  for (let i = 0; i < line.coords.length - 1; i++) {
    const segStart = line.cum[i];
    const segLen = line.cum[i + 1] - segStart;
    if (line.cum[i + 1] < fromM) continue;

    const [ax, ay] = line.coords[i];
    const [bx, by] = line.coords[i + 1];
    const abx = (bx - ax) * kx, aby = (by - ay) * ky;
    const apx = (lon - ax) * kx, apy = (lat - ay) * ky;
    const len2 = abx * abx + aby * aby;
    const tMin = segLen > 0 ? Math.max(0, (fromM - segStart) / segLen) : 0;
    const tRaw = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
    const t = Math.min(1, Math.max(tMin, tRaw));

    const dx = apx - t * abx, dy = apy - t * aby;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestM = segStart + t * segLen;
    }
  }
  return bestM;
}

// Vị trí các trạm dọc tuyến: duyệt theo stop_order, mỗi trạm chỉ tìm từ trạm trước trở đi
// (tuyến vòng ghé một trạm hai lần vẫn đúng); một trạm ghé nhiều lần giữ lần đầu.
function stopProgress(line, stops) {
  const result = new Map();
  let from = 0;
  for (const st of stops) {
    const m = project(line, [Number(st.longitude), Number(st.latitude)], from);
    if (!result.has(st.stop_id)) result.set(st.stop_id, m);
    from = m;
  }
  return result;
}

module.exports = { haversineM, buildLine, project, stopProgress };
