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
import { listStops, listRouteStops } from "../../../../modules/stops/stops.service.js";
import { planTrip } from "../../../../modules/trip-plan/trip-plan.service.js";
import { getRoutePath, flattenPathCoords } from "../../../../modules/paths/paths.service.js";
import { subscribeTrips, watchTrip, clearTripWatch, onTripWatchChange, getWatchedTrip } from "./trip-watch.js";

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
  // Bỏ theo dõi ngay: xe và bảng biến mất, không còn ở trong room khi đang tìm tuyến mới
  clearTripWatch();
  activeTripResult = null;
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

const STATUS_LABEL = { RUNNING: "Đang chạy", UPCOMING: "Sắp xuất bến", PASSED: "Đã qua trạm của bạn" };
let activeTripResult = null;
export const resetTripFinderState = () => { activeTripResult = null; };

const formatClock = iso =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const etaText = t => (t.eta_board ? `~${formatClock(t.eta_board)} (${t.minutes_to_board} phút)` : "");

function renderTripSchedules({ trips, watchedScheduleId, error }) {
  const list = document.querySelector("#tripResults .trip-card.active .trip-schedules");
  if (!list) return;
  if (error) {
    list.innerHTML = `<li class="trip-empty">Không tải được danh sách chuyến</li>`;
    return;
  }
  if (trips.length === 0) {
    list.innerHTML = `<li class="trip-empty"><i class="fa-solid fa-clock-rotate-left"></i> Hiện không có chuyến nào trong 2 giờ tới</li>`;
    return;
  }

  // Tự động theo dõi chuyến phù hợp nhất nếu chưa có chuyến nào được chọn
  if (watchedScheduleId === null && trips.length > 0) {
    const autoTrip = trips.find(t => t.status === "RUNNING") || trips.find(t => t.status === "UPCOMING") || trips[0];
    if (autoTrip) {
      watchTrip(autoTrip.schedule_id);
      return;
    }
  }

  list.innerHTML = "";
  trips.forEach(t => {
    const li = document.createElement("li");
    const passed = t.status === "PASSED";
    const isWatched = t.schedule_id === watchedScheduleId;
    li.className = `trip-schedule${passed ? " passed" : ""}${isWatched ? " active" : ""}`;

    const etaDisplay = t.eta_board
      ? etaText(t)
      : (passed ? "Xe đang trên tuyến" : "");

    li.innerHTML = `
      <div class="trip-schedule-main"><b>${escapeHtml(t.departure_time)}</b> · ${escapeHtml(t.plate_number)} · ${escapeHtml(t.driver_name || "")}</div>
      <div class="trip-schedule-meta">
        <span class="trip-status ${t.status.toLowerCase()}">${STATUS_LABEL[t.status]}</span>
        <span class="trip-eta">${escapeHtml(etaDisplay)}</span>
      </div>`;

    // Cho phép click vào MỌI chuyến (kể cả xe đã qua trạm) để theo dõi và xem vị trí xe trên bản đồ
    li.onclick = e => {
      e.stopPropagation();
      watchTrip(t.schedule_id);
    };
    list.appendChild(li);
  });
}

// Bảng "Theo dõi xe" của khách: chỉ hiện khi đang theo dõi 1 chuyến
function renderGuestDashboard({ watchedScheduleId, ended }) {
  if (state.isStaff) return;
  const visible = watchedScheduleId !== null;
  document.getElementById("fleetDashboard").style.display = visible ? "block" : "none";
  document.getElementById("guestTripInfo").style.display = visible ? "block" : "none";
  if (!visible) return;

  const trip = getWatchedTrip();
  if (activeTripResult) document.getElementById("busRouteName").innerText = `Tuyến ${activeTripResult.route_number}`;
  if (trip) {
    document.getElementById("busPlate").innerText = trip.plate_number;
    document.getElementById("busDriver").innerText = trip.driver_name || "--";
    document.getElementById("busDeparture").innerText = trip.departure_time;
  }
  let eta = "--";
  if (ended) eta = "Chuyến đã kết thúc";
  else if (trip && trip.status === "PASSED") eta = "Xe đã qua trạm đón của bạn (đang chạy)";
  else if (trip && trip.status === "UPCOMING") eta = `Chưa xuất bến — dự kiến ${trip.departure_time}${trip.eta_board ? ` · tới trạm ${etaText(trip)}` : ""}`;
  else if (trip && trip.eta_board) eta = etaText(trip);
  document.getElementById("busEta").innerText = eta;
}

onTripWatchChange(change => {
  renderTripSchedules(change);
  renderGuestDashboard(change);
});

function openTripList(card, result) {
  document.querySelectorAll("#tripResults .trip-schedules").forEach(el => el.remove());
  const list = document.createElement("ul");
  list.className = "trip-schedules";
  list.innerHTML = `<li class="trip-empty"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải chuyến...</li>`;
  card.appendChild(list);
  activeTripResult = result;
  ["busPlate", "busDriver", "busDeparture", "busSpeed"].forEach(id => { document.getElementById(id).innerText = "--"; });
  subscribeTrips({
    route_id: result.route_id,
    direction: result.direction,
    board_stop_id: result.board_stop ? result.board_stop.stop_id : null
  });
}

function renderTripResults(data, position) {
  lastTripResults = data.results || [];
  clearTripWatch();
  activeTripResult = null;
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
    // Chỉ gom vị trí người dùng vào khung nhìn nếu ở gần điểm đến (< 2.5km), tránh bị kéo zoom lệch hàng chục km
    const distM = Math.hypot(position.longitude - dest.longitude, position.latitude - dest.latitude) * 111000;
    if (distM < 2500) {
      focus.push([position.longitude, position.latitude]);
    }
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
      if (li.classList.contains("active")) return;   // bấm lại thẻ đang mở (vd. vùng trống của danh sách chuyến)
      resultsEl.querySelectorAll(".trip-card").forEach(c => c.classList.remove("active"));
      li.classList.add("active");
      clearTripWatch();
      showTripOnMap(lastTripResults[idx], data.destination, position);
      openTripList(li, lastTripResults[idx]);
    };
    resultsEl.appendChild(li);
  });
}

// Vẽ toàn bộ tuyến tim đường (màu nhạt) + đoạn lộ trình khách đi (màu đậm) + toàn bộ trạm của tuyến
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

  // 1. Tải và vẽ lộ trình tim đường (cả toàn tuyến và phân đoạn khách đi)
  let routeCoordsForZoom = null;
  try {
    const path = await getRoutePath(result.route_id, state.currentDirection);
    // Người dùng có thể đã chọn tuyến khác trong lúc chờ tải
    if (state.currentSelectedRoute !== result.route_id) return;

    const fullCoords = flattenPathCoords(path.geometry);
    const segment = clipPathBetween(fullCoords, board, alight);

    if (map.routeLayer) {
      // 1.1. Vẽ toàn bộ lộ trình tim đường của tuyến (xanh nhạt để định hướng toàn tuyến)
      if (fullCoords.length > 1) {
        map.routeLayer.add(new map.Graphic({
          geometry: { type: "polyline", paths: fullCoords },
          symbol: { type: "simple-line", color: [0, 122, 255, 0.4], width: 4 }
        }));
      }
      // 1.2. Vẽ đoạn phân đoạn thực tế khách sẽ đi (xanh dương đậm nổi bật)
      if (segment.length > 1) {
        map.routeLayer.add(new map.Graphic({
          geometry: { type: "polyline", paths: [segment] },
          symbol: { type: "simple-line", color: [0, 122, 255, 0.95], width: 6 }
        }));
      }
    }
    // Ưu tiên zoom bao quát toàn tuyến để căn giữa và nhìn thấy đầy đủ hướng tuyến
    if (fullCoords && fullCoords.length > 1) {
      routeCoordsForZoom = fullCoords;
    } else if (segment && segment.length > 1) {
      routeCoordsForZoom = segment;
    }
  } catch (e) {
    console.warn("Lỗi tải tim đường tuyến:", e);
  }

  // 2. Tải và vẽ toàn bộ trạm dừng của tuyến theo chiều
  try {
    const stops = await listRouteStops(result.route_id, state.currentDirection);
    if (state.currentSelectedRoute === result.route_id) {
      state.currentRawStops = stops || [];
      if (map.stopsLayer && map.Graphic) {
        map.stopsLayer.removeAll();
        state.currentRawStops.forEach((st, idx) => {
          const order = st.stop_order || (idx + 1);
          const stopGraphic = new map.Graphic({
            geometry: { type: "point", longitude: st.longitude, latitude: st.latitude },
            symbol: {
              type: "simple-marker",
              color: [0, 150, 136, 0.85],
              size: "9px",
              outline: { color: [255, 255, 255], width: 1.5 }
            },
            attributes: st,
            popupTemplate: {
              title: `Trạm #${order}: {stop_name}`,
              content: `<b>Mã trạm:</b> {stop_id}<br><b>Địa chỉ:</b> {address}<br><b>Tọa độ:</b> [{longitude}, {latitude}]`
            }
          });
          map.stopsLayer.add(stopGraphic);
        });
      }
    }
  } catch (e) {
    console.warn("Lỗi tải danh sách trạm của tuyến:", e);
  }

  // 3. Zoom căn giữa và phóng lớn bao quát tuyến xe buýt
  const zoomTarget = (routeCoordsForZoom && routeCoordsForZoom.length > 1) ? routeCoordsForZoom : focus;
  goToSequential(zoomTarget, { duration: 800 });

  clearTripLayer();
  addTripMarker(dest.longitude, dest.latitude, [220, 38, 38], `Điểm đến: ${dest.stop_name}`, escapeHtml(dest.address || ""));
  if (position) addTripMarker(position.longitude, position.latitude, [37, 99, 235], "Vị trí của bạn");
  if (result.board_stop) {
    addTripMarker(result.board_stop.longitude, result.board_stop.latitude, [22, 163, 74], `Lên xe: ${result.board_stop.stop_name}`, `Tuyến ${escapeHtml(result.route_number)} (Trạm đón)`);
  }
  addTripMarker(result.alight_stop.longitude, result.alight_stop.latitude, [234, 88, 12], `Xuống xe: ${result.alight_stop.stop_name}`, `Tuyến ${escapeHtml(result.route_number)} (Trạm xuống)`);
}
