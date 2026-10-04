// --------------------------------------------------------------------
// TÌM TUYẾN CHO KHÁCH: nhập điểm đến → liệt kê tuyến đi thẳng từ vị trí hiện tại
// --------------------------------------------------------------------
import { state, map } from "../../map.state.js";
import { escapeHtml } from "../../../../core/dom.js";
import { showToast } from "../../../../core/toast.js";
import { goToSequential, clearRouteGraphics } from "../base-map.js";
import { applyFleetFilter } from "../fleet-tracking.js";
import { getUserPosition } from "../geolocation.js";
import { buildStopIndex, getStopIndex, normalizeText, findStopsByAddress, searchStopsByName } from "./stop-search.js";
import { clipPathBetween } from "./path-clip.js";
import { listStops } from "../../../../modules/stops/stops.service.js";
import { planTrip } from "../../../../modules/trip-plan/trip-plan.service.js";
import { getRoutePath, flattenPathCoords } from "../../../../modules/paths/paths.service.js";

let lastTripResults = [];

export const hasStopIndex = () => getStopIndex().length > 0;

export async function loadStopIndex() {
  try {
    const data = await listStops();
    buildStopIndex(data.features || []);
    renderDestSuggestions();
  } catch (e) {
    showToast("Không tải được danh sách trạm. Kiểm tra kết nối máy chủ.", "error");
  }
}

export function clearTripLayer() {
  if (map.tripLayer) map.tripLayer.removeAll();
}

export function renderDestSuggestions() {
  const list = document.getElementById("destSuggestions");
  const keyword = normalizeText(document.getElementById("destInput").value);
  list.innerHTML = "";
  if (!keyword) {
    list.style.display = "none";
    return;
  }

  const matches = searchStopsByName(keyword);
  const addressMatch = findStopsByAddress(keyword);
  const addressStops = addressMatch ? addressMatch.stops : [];
  const addressIds = new Set(addressStops.map(st => st.stop_id));
  const nameStops = matches.filter(st => !addressIds.has(st.stop_id));

  list.style.display = "block";
  if (addressStops.length === 0 && nameStops.length === 0) {
    list.innerHTML = `<li class="trip-empty">${hasStopIndex() ? "Không tìm thấy trạm phù hợp" : "Đang tải danh sách trạm..."}</li>`;
    return;
  }

  const addSection = title => {
    const li = document.createElement("li");
    li.className = "suggest-section";
    li.textContent = title;
    list.appendChild(li);
  };
  const addStop = (st, icon, note) => {
    const li = document.createElement("li");
    li.className = "stop-item";
    li.innerHTML = `
      <i class="fa-solid ${icon}" style="color: #009688;"></i>
      <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <div style="font-weight: 600; color: #1e293b;">${escapeHtml(st.stop_name)}</div>
        <div style="font-size: 11px; color: #64748b;">${escapeHtml(st.address || st.stop_id)}</div>
        ${note ? `<div style="font-size: 11px; color: #0079c1;">${escapeHtml(note)}</div>` : ""}
      </div>`;
    li.onclick = () => selectDestination(st);
    list.appendChild(li);
  };

  if (addressStops.length > 0) {
    addSection("Gần địa chỉ bạn nhập");
    addressStops.forEach(st => {
      const diff = addressMatch.houseNumber === null ? null : Math.abs(st.houseNumber - addressMatch.houseNumber);
      const note = diff === null ? "" : diff === 0 ? "Đúng số nhà bạn nhập" : `≈ lệch ${diff} số nhà so với số ${addressMatch.houseNumber}`;
      addStop(st, "fa-house-flag", note);
    });
    if (nameStops.length > 0) addSection("Trạm theo tên");
  }
  nameStops.forEach(st => addStop(st, "fa-location-dot"));
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km` : `${meters} m`;
}

function setOriginStatus(type, message) {
  const box = document.getElementById("tripOriginStatus");
  const icon = type === "ok" ? "fa-location-dot" : type === "warn" ? "fa-triangle-exclamation" : "fa-spinner fa-spin";
  box.className = `trip-origin-status ${type}`;
  box.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
}

function addTripMarker(longitude, latitude, color, title, content) {
  if (!map.Graphic || !map.tripLayer) return;
  map.tripLayer.add(new map.Graphic({
    geometry: { type: "point", longitude, latitude },
    symbol: { type: "simple-marker", color, size: "16px", outline: { color: [255, 255, 255], width: 2.5 } },
    attributes: { title },
    popupTemplate: { title, content: content || "" }
  }));
}

async function selectDestination(stop) {
  document.getElementById("destInput").value = stop.stop_name;
  document.getElementById("destSuggestions").style.display = "none";

  const resultsEl = document.getElementById("tripResults");
  resultsEl.innerHTML = `<li class="trip-empty"><i class="fa-solid fa-spinner fa-spin"></i> Đang tìm tuyến...</li>`;
  document.getElementById("tripResultsCount").innerText = "";
  setOriginStatus("", "Đang xác định vị trí của bạn...");

  const position = await getUserPosition();
  if (position) {
    setOriginStatus("ok", `Đã xác định vị trí của bạn (sai số ~${Math.round(position.accuracy)} m)`);
  } else {
    setOriginStatus("warn", "Chưa có vị trí. Bật định vị để lọc tuyến đi từ vị trí của bạn; đang hiển thị mọi tuyến qua điểm đến.");
  }

  try {
    const data = await planTrip(stop.stop_id, position);
    renderTripResults(data, position);
  } catch (e) {
    resultsEl.innerHTML = `<li class="trip-empty">Không tìm được tuyến: ${escapeHtml(e.message)}</li>`;
  }
}

function renderTripResults(data, position) {
  lastTripResults = data.results || [];
  const resultsEl = document.getElementById("tripResults");
  document.getElementById("tripResultsCount").innerText = `${lastTripResults.length} tuyến`;

  // Vẽ lại điểm xuất phát / điểm đến, chưa chọn tuyến cụ thể
  state.currentSelectedRoute = "ALL";
  state.currentRawStops = [];
  applyFleetFilter();
  clearRouteGraphics();
  clearTripLayer();
  const dest = data.destination;
  addTripMarker(dest.longitude, dest.latitude, [220, 38, 38], `Điểm đến: ${dest.stop_name}`, escapeHtml(dest.address || ""));
  const focus = [[dest.longitude, dest.latitude]];
  if (position) {
    addTripMarker(position.longitude, position.latitude, [37, 99, 235], "Vị trí của bạn");
    focus.push([position.longitude, position.latitude]);
  }
  goToSequential(focus.length > 1 ? focus : { center: focus[0], zoom: 16 }, { duration: 700 });

  if (lastTripResults.length === 0) {
    resultsEl.innerHTML = `<li class="trip-empty">Không có tuyến xe buýt đi thẳng tới điểm đến này.</li>`;
    return;
  }

  resultsEl.innerHTML = "";
  lastTripResults.forEach((r, idx) => {
    const li = document.createElement("li");
    li.className = "trip-card";
    const dirLabel = Number(r.direction) === 1 ? "Lượt đi" : "Lượt về";
    const boardStep = r.board_stop
      ? `<div class="trip-step"><i class="fa-solid fa-person-walking"></i><span>Lên xe tại trạm <b>${escapeHtml(r.board_stop.stop_name)}</b> (cách bạn ${formatDistance(r.board_stop.walk_m)})</span></div>
         <div class="trip-step"><i class="fa-solid fa-bus"></i><span>Đi ${r.num_stops} trạm</span></div>`
      : "";
    const alightWalk = r.alight_stop.walk_m > 0 ? ` (cách điểm đến ${formatDistance(r.alight_stop.walk_m)})` : "";
    li.innerHTML = `
      <div class="trip-card-head">
        <span class="trip-route-badge">${escapeHtml(r.route_number)}</span>
        <span class="trip-route-name" title="${escapeHtml(r.route_name)}">${escapeHtml(r.route_name)}</span>
      </div>
      <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${dirLabel}</div>
      ${boardStep}
      <div class="trip-step"><i class="fa-solid fa-flag-checkered"></i><span>Xuống tại <b>${escapeHtml(r.alight_stop.stop_name)}</b>${alightWalk}</span></div>`;
    li.onclick = () => {
      resultsEl.querySelectorAll(".trip-card").forEach(c => c.classList.remove("active"));
      li.classList.add("active");
      showTripOnMap(lastTripResults[idx], data.destination, position);
    };
    resultsEl.appendChild(li);
  });
}

// Chỉ vẽ đoạn lộ trình khách thực sự đi (trạm lên → trạm xuống) + 2 trạm đó, chỉ hiện xe của tuyến
async function showTripOnMap(result, dest, position) {
  state.currentSelectedRoute = result.route_id;
  state.currentDirection = Number(result.direction);
  state.currentRawStops = [];
  applyFleetFilter();
  clearRouteGraphics();

  const board = result.board_stop ? [result.board_stop.longitude, result.board_stop.latitude] : null;
  const alight = [result.alight_stop.longitude, result.alight_stop.latitude];
  const focus = [alight];
  if (board) focus.push(board);
  try {
    const path = await getRoutePath(result.route_id, state.currentDirection);
    const segment = clipPathBetween(flattenPathCoords(path.geometry), board, alight);
    // Người dùng có thể đã chọn tuyến khác trong lúc chờ tải
    if (state.currentSelectedRoute !== result.route_id) return;
    if (segment.length > 1 && map.routeLayer) {
      map.routeLayer.add(new map.Graphic({
        geometry: { type: "polyline", paths: [segment] },
        symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 5 }
      }));
      focus.push(...segment);
    }
  } catch (e) {}
  if (position) focus.push([position.longitude, position.latitude]);
  goToSequential(focus, { duration: 800 });

  clearTripLayer();
  addTripMarker(dest.longitude, dest.latitude, [220, 38, 38], `Điểm đến: ${dest.stop_name}`, escapeHtml(dest.address || ""));
  if (position) addTripMarker(position.longitude, position.latitude, [37, 99, 235], "Vị trí của bạn");
  if (result.board_stop) {
    addTripMarker(result.board_stop.longitude, result.board_stop.latitude, [22, 163, 74], `Lên xe: ${result.board_stop.stop_name}`, `Tuyến ${escapeHtml(result.route_number)}`);
  }
  addTripMarker(result.alight_stop.longitude, result.alight_stop.latitude, [234, 88, 12], `Xuống xe: ${result.alight_stop.stop_name}`, `Tuyến ${escapeHtml(result.route_number)}`);
}
