// Sidebar điều hành (ADMIN/MANAGER): chọn tuyến, chiều, tìm trạm, danh sách trạm trên tuyến
import { state, map } from "../map.state.js";
import { escapeHtml } from "../../../core/dom.js";
import { goToSequential, clearRouteGraphics } from "./base-map.js";
import { applyFleetFilter } from "./fleet-tracking.js";
import { listRoutes } from "../../../modules/bus-routes/bus-routes.service.js";
import { getRoutePath } from "../../../modules/paths/paths.service.js";
import { listStops, listRouteStops, featureToStop } from "../../../modules/stops/stops.service.js";

// --------------------------------------------------------------------
// NẠP DANH SÁCH TUYẾN & XỬ LÝ CHỌN TUYẾN
// --------------------------------------------------------------------
export async function loadRoutesList(autoSelect = true) {
  try {
    state.allRoutes = await listRoutes();

    const select = document.getElementById("routeSelect");
    select.innerHTML = `<option value="ALL">🌐 Hiển thị Tất cả các Tuyến</option>`;

    select.innerHTML += state.allRoutes
      .map(r => `<option value="${escapeHtml(r.route_id)}">Tuyến ${escapeHtml(r.route_number)}: ${escapeHtml(r.route_name)}</option>`)
      .join("");

    document.getElementById("routeCountBadge").innerText = `${state.allRoutes.length} tuyến`;

    if (!autoSelect) return;
    if (state.allRoutes.length > 0) {
      select.value = state.allRoutes[0].route_id;
      onRouteChanged();
    } else {
      loadAllRoutesAndStops();
    }
  } catch (err) {
    console.warn("Lỗi tải tuyến xe:", err);
  }
}

function syncDirectionButtons() {
  document.getElementById("btnDir1").classList.toggle("active", state.currentDirection === 1);
  document.getElementById("btnDir2").classList.toggle("active", state.currentDirection === 2);
}

export function setDirection(dir) {
  state.currentDirection = dir;
  syncDirectionButtons();
  onRouteChanged();
}

// Vào chế độ điều hành luôn bắt đầu ở Lượt đi (khách có thể đã xem chuyến Lượt về trước khi đăng nhập)
export function resetDirection() {
  state.currentDirection = 1;
  syncDirectionButtons();
}

export async function onRouteChanged() {
  const select = document.getElementById("routeSelect");
  state.currentSelectedRoute = select.value;
  state.selectedTrackedVehicleId = null;
  const dirGroup = document.getElementById("directionGroup");

  if (state.currentSelectedRoute === "ALL") {
    dirGroup.style.display = "none";
    document.getElementById("routeNameDisplay").innerText = "Tất cả các tuyến trong hệ thống";
    document.getElementById("routeDistanceDisplay").innerText = "-- km";
    document.getElementById("routeHeadwayDisplay").innerText = "-- phút";
    loadAllRoutesAndStops();
  } else {
    dirGroup.style.display = "block";
    const route = state.allRoutes.find(r => r.route_id === state.currentSelectedRoute);
    if (route) {
      document.getElementById("routeNameDisplay").innerText = `Tuyến ${route.route_number} - ${route.route_name}`;
      document.getElementById("routeDistanceDisplay").innerText = `${route.distance_km} km`;
      document.getElementById("routeHeadwayDisplay").innerText = `${route.headway_min} phút`;
    }
    loadSingleRouteData(state.currentSelectedRoute, state.currentDirection);
  }

  applyFleetFilter();
}

async function loadSingleRouteData(routeId, direction) {
  if (!map.routeLayer || !map.stopsLayer) return;
  clearRouteGraphics();

  // 1. Tải lộ trình
  try {
    const pathGeoJson = await getRoutePath(routeId, direction);
    const coords = pathGeoJson.geometry.coordinates;

    const routePolyline = new map.Graphic({
      geometry: { type: "polyline", paths: coords },
      symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 5 }
    });
    map.routeLayer.add(routePolyline);

    if (map.view && coords.length > 0) {
      goToSequential(coords, { duration: 800 });
    }
  } catch (e) {}

  // 2. Tải danh sách trạm
  try {
    state.currentRawStops = await listRouteStops(routeId, direction);
    renderStopsList(state.currentRawStops);
  } catch (e) {}
}

async function loadAllRoutesAndStops() {
  if (!map.routeLayer || !map.stopsLayer) return;
  clearRouteGraphics();

  try {
    const data = await listStops();
    const features = data.features || [];
    state.currentRawStops = features.map((f, i) => ({ ...featureToStop(f), stop_order: i + 1 }));
    renderStopsList(state.currentRawStops);
  } catch (e) {}
}

// --------------------------------------------------------------------
// TÌM KIẾM TRẠM DỪNG & RENDER DANH SÁCH
// --------------------------------------------------------------------
export function filterStops() {
  const keyword = document.getElementById("stopSearchInput").value.toLowerCase().trim();
  if (!keyword) {
    renderStopsList(state.currentRawStops);
    return;
  }
  const filtered = state.currentRawStops.filter(s =>
    (s.stop_name && s.stop_name.toLowerCase().includes(keyword)) ||
    (s.address && s.address.toLowerCase().includes(keyword)) ||
    (s.stop_id && s.stop_id.toLowerCase().includes(keyword))
  );
  renderStopsList(filtered);
}

function renderStopsList(stops) {
  document.getElementById("stopsCount").innerText = `${stops.length} trạm`;
  const timeline = document.getElementById("stopsTimeline");
  timeline.innerHTML = "";
  if (map.stopsLayer) map.stopsLayer.removeAll();

  if (stops.length === 0) {
    timeline.innerHTML = `<li style="padding: 10px; color: #94a3b8; text-align: center;">Không tìm thấy trạm phù hợp</li>`;
    return;
  }

  stops.forEach((st, idx) => {
    const order = st.stop_order || (idx + 1);

    // Marker trên bản đồ
    if (map.Graphic && map.stopsLayer) {
      const stopGraphic = new map.Graphic({
        geometry: { type: "point", longitude: st.longitude, latitude: st.latitude },
        symbol: {
          type: "simple-marker",
          color: [0, 150, 136],
          size: "11px",
          outline: { color: [255, 255, 255], width: 1.5 }
        },
        attributes: st,
        popupTemplate: {
          title: `Trạm #${order}: {stop_name}`,
          content: `<b>Mã trạm:</b> {stop_id}<br><b>Địa chỉ:</b> {address}<br><b>Tọa độ:</b> [{longitude}, {latitude}]`
        }
      });
      map.stopsLayer.add(stopGraphic);
    }

    // Item trên Sidebar
    const li = document.createElement("li");
    li.className = "stop-item";
    li.innerHTML = `
      <div class="stop-order">${escapeHtml(order)}</div>
      <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <div style="font-weight: 600; color: #1e293b;">${escapeHtml(st.stop_name)}</div>
        <div style="font-size: 11px; color: #64748b;">${escapeHtml(st.address || st.stop_id)}</div>
      </div>
      <i class="fa-solid fa-chevron-right" style="color: #cbd5e1; font-size: 10px;"></i>
    `;
    li.onclick = () => {
      if (map.view) {
        map.view.goTo({ center: [st.longitude, st.latitude], zoom: 17 }, { duration: 600 });
        map.view.openPopup({
          title: `Trạm #${escapeHtml(order)}: ${escapeHtml(st.stop_name)}`,
          content: `<b>Mã trạm:</b> ${escapeHtml(st.stop_id)}<br><b>Địa chỉ:</b> ${escapeHtml(st.address || "---")}`,
          location: { type: "point", longitude: st.longitude, latitude: st.latitude }
        });
      }
    };
    timeline.appendChild(li);
  });
}
