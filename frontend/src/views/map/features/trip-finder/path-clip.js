// Cắt đoạn lộ trình khách thực sự đi (trạm lên → trạm xuống) trên polyline [lon, lat]

// Chiếu điểm p lên đoạn a-b (xấp xỉ phẳng, đủ chính xác trong phạm vi một tuyến nội thành)
function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * Math.PI / 180);
  const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (((p[0] - a[0]) * kx) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const ex = (p[0] - q[0]) * kx, ey = p[1] - q[1];
  return { point: q, t, dist2: ex * ex + ey * ey };
}

// Vị trí gần p nhất trên lộ trình, chỉ xét từ đoạn fromSeg trở đi (tuyến vòng ghé lại cùng khu vực)
function locateOnPath(coords, p, fromSeg = 0, fromT = 0) {
  let best = null;
  for (let i = fromSeg; i < coords.length - 1; i++) {
    const pr = projectOnSegment(p, coords[i], coords[i + 1]);
    if (i === fromSeg && pr.t < fromT) continue;
    if (!best || pr.dist2 < best.dist2) best = { seg: i, t: pr.t, point: pr.point, dist2: pr.dist2 };
  }
  return best;
}

// Cắt lộ trình từ trạm lên tới trạm xuống; không có trạm lên → cắt từ đầu tuyến
export function clipPathBetween(coords, fromLngLat, toLngLat) {
  if (coords.length < 2) return coords;
  const start = fromLngLat ? locateOnPath(coords, fromLngLat) : { seg: 0, t: 0, point: coords[0] };
  const end = locateOnPath(coords, toLngLat, start.seg, start.t) || locateOnPath(coords, toLngLat);
  if (!end || end.seg < start.seg || (end.seg === start.seg && end.t < start.t)) return coords;
  return [start.point, ...coords.slice(start.seg + 1, end.seg + 1), end.point];
}
