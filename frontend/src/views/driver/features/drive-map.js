import { state } from "../driver.state.js";
import { loadArcgisModules } from "../../../core/arcgis.js";
import { showToast } from "../../../core/toast.js";
import { getRoutePath, flattenPathCoords } from "../../../modules/paths/paths.service.js";
import { listRouteStops } from "../../../modules/stops/stops.service.js";
import { connectRealtime } from "../../../modules/realtime/realtime.service.js";
import { getToken } from "../../../core/session.js";
import { DRIVER_TOKEN_KEY } from "../../../core/config.js";
import { nextStop } from "./next-stop.js";
import { directionLabel } from "./trip-select.js";

const SIGNAL_TIMEOUT_MS = 10000;

// Đối tượng ArcGIS & kết nối viewer của màn Chạy xe
const ctx = {
  view: null, Graphic: null, Point: null,
  routeLayer: null, stopsLayer: null, busLayer: null, busGraphic: null,
  socket: null, signalTimer: null,
  pathCoords: [], stops: [], follow: true, lastFixAt: 0
};

async function ensureMap() {
  if (ctx.view) return;
  const [EsriMap, MapView, Graphic, GraphicsLayer, Point] = await loadArcgisModules([
    "esri/Map", "esri/views/MapView", "esri/Graphic", "esri/layers/GraphicsLayer", "esri/geometry/Point"
  ]);
  Object.assign(ctx, { Graphic, Point });
  ctx.routeLayer = new GraphicsLayer();
  ctx.stopsLayer = new GraphicsLayer();
  ctx.busLayer = new GraphicsLayer();
  ctx.view = new MapView({
    container: "driveMap",
    map: new EsriMap({ basemap: "streets-navigation-vector", layers: [ctx.routeLayer, ctx.stopsLayer, ctx.busLayer] }),
    center: [106.70, 10.78],
    zoom: 13,
    ui: { components: ["zoom"] }
  });
  // Người dùng tự kéo bản đồ → tắt bám xe
  ctx.view.on("drag", () => setFollow(false));
  await ctx.view.when();
}

function setBadge(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `badge ${cls}`;
}

// Nguồn GPS: trang này đang phát → Điện thoại; nhận vị trí xe mình mà không phát → Thiết bị khác
export function refreshSourceBadge() {
  if (Date.now() - ctx.lastFixAt >= SIGNAL_TIMEOUT_MS) return setBadge("gpsSourceBadge", "Chưa có tín hiệu", "badge-idle");
  if (state.broadcasting) return setBadge("gpsSourceBadge", "Điện thoại", "badge-on");
  setBadge("gpsSourceBadge", "Thiết bị khác", "badge-warn");
}

function setFollow(on) {
  ctx.follow = on;
  document.getElementById("btnFollow").classList.toggle("active", on);
}

export function toggleFollow() {
  setFollow(!ctx.follow);
  if (ctx.follow && ctx.busGraphic) ctx.view.goTo(ctx.busGraphic.geometry, { animate: false }).catch(() => {});
}

const formatDistance = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

function renderNextStop(position) {
  const result = nextStop(position, ctx.pathCoords, ctx.stops);
  document.getElementById("nextStopName").textContent = result
    ? result.stop.stop_name
    : (ctx.stops.length ? "Đã đến cuối tuyến" : "—");
  document.getElementById("nextStopDistance").textContent = result ? formatDistance(result.distanceMeters) : "";
}

function showBus({ longitude, latitude }) {
  const geometry = new ctx.Point({ longitude, latitude });
  if (!ctx.busGraphic) {
    ctx.busGraphic = new ctx.Graphic({
      geometry,
      symbol: { type: "simple-marker", color: [255, 59, 48], size: 18, outline: { color: [255, 255, 255], width: 3 } }
    });
    ctx.busLayer.add(ctx.busGraphic);
  } else {
    ctx.busGraphic.geometry = geometry;
  }
  if (ctx.follow && !ctx.view.interacting) ctx.view.goTo({ center: [longitude, latitude] }, { animate: false }).catch(() => {});
}

function hideBus() {
  if (ctx.busLayer) ctx.busLayer.removeAll();
  ctx.busGraphic = null;
  ctx.lastFixAt = 0;
  refreshSourceBadge();
}

// Vị trí xe mình lấy từ room vehicle:<id> (server cho vào theo token) → đúng dù GPS đến từ điện thoại hay simulator
function onFleetUpdate(data) {
  if (!state.vehicle || data.vehicle_id !== state.vehicle.vehicle_id) return;
  ctx.lastFixAt = Date.now();
  refreshSourceBadge();
  showBus(data);
  document.getElementById("driveSpeed").textContent = Math.round(data.speed_kmh || 0);
  renderNextStop([data.longitude, data.latitude]);
}

async function drawRoute(schedule) {
  ctx.routeLayer.removeAll();
  ctx.stopsLayer.removeAll();
  ctx.pathCoords = [];
  ctx.stops = [];
  try {
    const [path, stops] = await Promise.all([
      getRoutePath(schedule.route_id, schedule.direction),
      listRouteStops(schedule.route_id, schedule.direction)
    ]);
    ctx.pathCoords = flattenPathCoords(path.geometry);
    ctx.stops = stops;
    const line = new ctx.Graphic({
      geometry: { type: "polyline", paths: [ctx.pathCoords] },
      symbol: { type: "simple-line", color: [37, 99, 235], width: 5 }
    });
    ctx.routeLayer.add(line);
    ctx.stopsLayer.addMany(stops.map(st => new ctx.Graphic({
      geometry: { type: "point", longitude: st.longitude, latitude: st.latitude },
      symbol: { type: "simple-marker", color: [20, 184, 166], size: 9, outline: { color: [255, 255, 255], width: 1.5 } },
      attributes: { name: st.stop_name },
      popupTemplate: { title: "{name}" }
    })));
    await ctx.view.goTo(line.geometry.extent.expand(1.2), { animate: false });
  } catch (err) {
    console.warn("Không tải được lộ trình:", err);
    showToast("Không tải được lộ trình tuyến", "error");
  }
}

function resetPanel() {
  document.getElementById("driveSpeed").textContent = "0";
  document.getElementById("nextStopName").textContent = "—";
  document.getElementById("nextStopDistance").textContent = "";
  document.getElementById("replacedBanner").hidden = true;
  setBadge("connBadge", "OFFLINE", "badge-off");
  setFollow(true);
  hideBus();
}

export async function openDrive() {
  const schedule = state.schedule;
  document.getElementById("tripRoute").textContent = `Tuyến ${schedule.route_number}`;
  document.getElementById("tripDirection").textContent = directionLabel(schedule.direction);
  await ensureMap();
  resetPanel();
  await drawRoute(schedule);

  ctx.socket = connectRealtime({
    token: getToken(DRIVER_TOKEN_KEY),
    onConnect: () => setBadge("connBadge", "ONLINE", "badge-on"),
    onDisconnect: () => setBadge("connBadge", "OFFLINE", "badge-off"),
    onFleetUpdate,
    onVehicleOffline: ({ vehicle_id }) => { if (vehicle_id === state.vehicle?.vehicle_id) hideBus(); }
  });
  ctx.signalTimer = setInterval(refreshSourceBadge, 2000);
}

export function closeDrive() {
  if (ctx.socket) ctx.socket.disconnect();
  ctx.socket = null;
  clearInterval(ctx.signalTimer);
  ctx.signalTimer = null;
  hideBus();
}
