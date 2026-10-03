// --------------------------------------------------------------------
// PHÂN TÍCH LỘ TRÌNH: ĐOẠN NHẢY XA & TRẠM LỆCH KHỎI PATH
// --------------------------------------------------------------------
const GAP_THRESHOLD_M = 300;      // Đoạn giữa 2 đỉnh liên tiếp dài hơn: nghi cắt ngang nhà
const STOP_FAR_THRESHOLD_M = 30;  // Trạm cách lộ trình xa hơn: nghi lệch

let currentGaps = [];
let gapCursor = -1;

// Khoảng cách mặt cầu (mét) giữa 2 điểm [lon, lat]
function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371008.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Các đoạn dài hơn ngưỡng, sắp xếp dài nhất trước
function findGaps(pathLonLat) {
  const gaps = [];
  for (let i = 1; i < pathLonLat.length; i++) {
    const length = haversineMeters(pathLonLat[i - 1], pathLonLat[i]);
    if (length > GAP_THRESHOLD_M) gaps.push({ index: i - 1, from: pathLonLat[i - 1], to: pathLonLat[i], length });
  }
  return gaps.sort((a, b) => b.length - a.length);
}

// Khoảng cách (mét) từ trạm tới điểm gần nhất trên lộ trình
function stopDistanceToPath(stopGraphic) {
  const nearest = editorGeometryEngine.nearestCoordinate(pathGraphic.geometry, stopGraphic.geometry);
  if (!nearest || !nearest.coordinate) return Infinity;
  const stopLonLat = viewToLonLat([stopGraphic.geometry.x, stopGraphic.geometry.y]);
  const nearestLonLat = viewToLonLat([nearest.coordinate.x, nearest.coordinate.y]);
  return haversineMeters(stopLonLat, nearestLonLat);
}

// Tính lại toàn bộ chỉ báo sau mỗi lần chỉnh sửa
function refreshAnalysis(savedSnapshot) {
  if (!pathGraphic) return;
  const pathLonLat = pathGraphic.geometry.paths.flat().map(viewToLonLat);
  currentGaps = findGaps(pathLonLat);
  gapCursor = -1;

  overlayLayer.removeAll();
  overlayLayer.addMany(currentGaps.map(g => new EditorGraphic({
    geometry: new EditorPolyline({ paths: [[lonLatToView(...g.from), lonLatToView(...g.to)]], spatialReference: editorView.spatialReference }),
    symbol: GAP_SYMBOL
  })));
  renderGapList();

  const current = takeSnapshot();
  const stopRows = stopGraphics.map((g, i) => {
    const distance = stopDistanceToPath(g);
    const isFar = distance > STOP_FAR_THRESHOLD_M;
    g.symbol = stopSymbol(isFar);
    return { graphic: g, distance, isFar, moved: stopMovedBetween(savedSnapshot, current, i) };
  });
  renderStopList(stopRows);
}

function renderGapList() {
  const list = document.getElementById("gap-list");
  if (currentGaps.length === 0) {
    list.innerHTML = `<li class="empty">Không có đoạn nào dài hơn ${GAP_THRESHOLD_M}m</li>`;
    return;
  }
  list.innerHTML = currentGaps
    .map((g, i) => `<li data-gap="${i}"><span>Đoạn sau đỉnh #${g.index + 1}</span><span>${Math.round(g.length)} m</span></li>`)
    .join("");
  list.querySelectorAll("li").forEach(li => {
    li.onclick = () => focusGap(Number(li.dataset.gap));
  });
}

function focusGap(i) {
  const gap = currentGaps[i];
  if (!gap) return;
  gapCursor = i;
  document.querySelectorAll("#gap-list li").forEach(li => li.classList.toggle("active", Number(li.dataset.gap) === i));
  zoomToLonLatSegment(gap.from, gap.to);
}

function focusNextGap() {
  if (currentGaps.length === 0) return;
  focusGap((gapCursor + 1) % currentGaps.length);
}

// Tên / địa chỉ trạm lấy từ dữ liệu nhập ngoài, cần escape trước khi chèn vào HTML
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderStopList(rows) {
  const list = document.getElementById("stop-list");
  if (rows.length === 0) {
    list.innerHTML = `<li class="empty">Tuyến chưa có trạm ở chiều này</li>`;
    return;
  }
  list.innerHTML = rows.map((r, i) => {
    const a = r.graphic.attributes;
    const dist = Number.isFinite(r.distance) ? `${Math.round(r.distance)} m` : "—";
    return `<li data-row="${i}" title="${escapeHtml(a.address)}">
      <span class="stop-name ${r.moved ? "moved" : ""}">${a.stop_order}. ${escapeHtml(a.stop_name)}</span>
      <span class="stop-dist ${r.isFar ? "far" : ""}">${dist}</span>
    </li>`;
  }).join("");
  list.querySelectorAll("li").forEach(li => {
    const graphic = rows[Number(li.dataset.row)].graphic;
    li.onclick = () => {
      zoomToStopGraphic(graphic);
      startEditingGraphic(graphic);
    };
  });
}
