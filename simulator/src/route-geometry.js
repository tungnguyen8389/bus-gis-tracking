// Hình học lộ trình cho tài xế ảo: tính quãng đường tích lũy & nội suy vị trí theo mét đã đi

// Khoảng cách thực tế giữa 2 tọa độ [lon, lat] (Haversine, mét)
function getDistanceMeters(p1, p2) {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLon = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Làm tròn 1 chữ số nhưng giữ trong [0, 360): 359.96 → 0 thay vì 360 (server từ chối 360)
const roundHeading = h => Number(h.toFixed(1)) % 360;

// Tiền xử lý lộ trình: quãng đường tích lũy và góc phương vị từng đoạn
function processRouteGeometry(coords) {
  if (!coords || coords.length < 2) return null;
  const segments = [];
  let totalDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dist = getDistanceMeters(p1, p2);

    const dLon = p2[0] - p1[0];
    const dLat = p2[1] - p1[1];
    let heading = 0;
    if (dLon !== 0 || dLat !== 0) {
      heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }

    segments.push({ p1, p2, dist, startDist: totalDist, endDist: totalDist + dist, heading });
    totalDist += dist;
  }

  return { coords, segments, totalDist: Math.max(10, totalDist) };
}

// Vị trí [lon, lat] và hướng tại quãng đường distMeters (quấn vòng khi vượt cuối tuyến)
function getInterpolatedPosition(processedRoute, distMeters) {
  const { segments, totalDist } = processedRoute;
  const targetDist = ((distMeters % totalDist) + totalDist) % totalDist;

  for (const seg of segments) {
    if (targetDist >= seg.startDist && targetDist <= seg.endDist) {
      const ratio = seg.dist > 0 ? (targetDist - seg.startDist) / seg.dist : 0;
      return {
        longitude: seg.p1[0] + (seg.p2[0] - seg.p1[0]) * ratio,
        latitude: seg.p1[1] + (seg.p2[1] - seg.p1[1]) * ratio,
        heading: roundHeading(seg.heading)
      };
    }
  }

  const last = segments[segments.length - 1];
  return { longitude: last.p2[0], latitude: last.p2[1], heading: roundHeading(last.heading) };
}

module.exports = { getDistanceMeters, processRouteGeometry, getInterpolatedPosition };
