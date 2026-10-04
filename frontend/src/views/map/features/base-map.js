import { state, map } from "../map.state.js";
import { loadArcgisModules } from "../../../core/arcgis.js";
import { showToast } from "../../../core/toast.js";
import { geolocationErrorMessage } from "./geolocation.js";

// --------------------------------------------------------------------
// KHỞI TẠO BẢN ĐỒ ARCGIS 2D
// --------------------------------------------------------------------
export async function createBaseMap() {
  const [EsriMap, MapView, Graphic, GraphicsLayer, Point, BasemapToggle, Locate, Track, reactiveUtils] = await loadArcgisModules([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer",
    "esri/geometry/Point",
    "esri/widgets/BasemapToggle",
    "esri/widgets/Locate",
    "esri/widgets/Track",
    "esri/core/reactiveUtils"
  ]);
  map.Graphic = Graphic;
  map.Point = Point;

  // 1. Khởi tạo 75% màn hình ở giữa là khung Bản đồ số 2D ArcGIS
  const esriMap = new EsriMap({ basemap: "streets-navigation-vector" });

  const mapView = new MapView({
    container: "viewDiv",
    map: esriMap,
    center: [106.80196, 10.87052], // Khu vực ĐHQG TP.HCM
    zoom: 14
  });
  map.view = mapView;
  // Sidebar (330px + lề 15px) và panel Theo dõi xe (310px góc dưới phải) nổi đè lên bản đồ
  // → chừa chỗ để goTo không đặt lộ trình dưới các panel (màn hẹp thì bỏ padding phải để còn chỗ cho bản đồ)
  const applyMapPadding = () => {
    const w = window.innerWidth;
    mapView.padding = w >= 768
      ? { left: 360, top: 60, right: w >= 1200 ? 340 : 20, bottom: 20 }
      : { top: 0, left: 0, right: 0, bottom: 0 };
  };
  applyMapPadding();
  window.addEventListener("resize", applyMapPadding);

  // Nút chuyển đổi nhanh ảnh Vệ tinh
  const basemapToggle = new BasemapToggle({ view: mapView, nextBasemap: "satellite" });
  mapView.ui.add(basemapToggle, "bottom-left");

  // Định vị vị trí hiện tại của người dùng (yêu cầu HTTPS hoặc localhost)
  if (!navigator.geolocation || !window.isSecureContext) {
    console.warn("Trình duyệt không hỗ trợ định vị hoặc trang không chạy trên HTTPS/localhost.");
  }

  // Nút định vị một lần: hiện chấm xanh + vòng sai số và zoom tới vị trí
  const locateWidget = new Locate({ view: mapView, scale: 5000 });
  locateWidget.on("locate", () => showToast("📍 Đã xác định vị trí của bạn", "success"));
  locateWidget.on("locate-error", (e) => showToast(geolocationErrorMessage(e.error), "error"));
  mapView.ui.add(locateWidget, "bottom-left");

  // Nút theo dõi liên tục: bám theo vị trí khi người dùng di chuyển
  const trackWidget = new Track({ view: mapView, scale: 5000 });
  let trackFirstFix = false;
  reactiveUtils.watch(() => trackWidget.tracking, (tracking) => {
    if (tracking) {
      trackFirstFix = false;
    } else if (trackFirstFix) {
      showToast("Đã tắt theo dõi vị trí", "info");
    }
  });
  trackWidget.on("track", () => {
    if (!trackFirstFix) {
      trackFirstFix = true;
      showToast("🛰️ Đang theo dõi vị trí của bạn", "success");
    }
  });
  trackWidget.on("track-error", (e) => {
    // Lỗi tạm thời (mất GPS chốc lát, hết giờ khi đứng yên) sau khi đã có vị trí: không spam toast
    if (trackFirstFix && trackWidget.tracking) {
      console.warn("Lỗi định vị tạm thời khi đang theo dõi:", e.error);
      return;
    }
    showToast(geolocationErrorMessage(e.error), "error");
  });
  mapView.ui.add(trackWidget, "bottom-left");

  // 2. Tạo các Layer riêng biệt để quản lý
  map.routeLayer = new GraphicsLayer({ title: "Lộ trình tim đường" });
  map.stopsLayer = new GraphicsLayer({ title: "Trạm đón trả khách" });
  map.fleetLayer = new GraphicsLayer({ title: "Đội xe buýt Realtime" });
  map.tripLayer = new GraphicsLayer({ title: "Hành trình của khách" });
  esriMap.addMany([map.routeLayer, map.stopsLayer, map.tripLayer, map.fleetLayer]);

  // Lắng nghe sự kiện click chọn xe trên bản đồ
  mapView.on("click", function(event) {
    mapView.hitTest(event).then(function(response) {
      const busResult = response.results.find(r => r.graphic && r.graphic.layer === map.fleetLayer);
      if (busResult && busResult.graphic && busResult.graphic.attributes) {
        state.selectedTrackedVehicleId = busResult.graphic.attributes.vehicle_id;
        const plate = busResult.graphic.attributes.plate || busResult.graphic.attributes.vehicle_id;
        showToast(`🎯 Đang theo dõi xe buýt: ${plate}`, "info");
      }
    });
  });
}

// ArcGIS 4.29 ném lỗi "reading 'animation'" nếu goTo chạy trước khi view sẵn sàng
// → chờ mapView.when() và xếp hàng các goTo tuần tự để không cắt ngang nhau
let goToChain = Promise.resolve();
export function goToSequential(target, options) {
  if (!map.view) return goToChain;
  goToChain = goToChain
    .then(() => map.view.when())
    .then(() => map.view.goTo(target, options))
    .catch(err => console.warn("Không thể di chuyển bản đồ:", err));
  return goToChain;
}

// --------------------------------------------------------------------
// BẬT / TẮT LỚP HIỂN THỊ
// --------------------------------------------------------------------
export function toggleLayer(layerType, isVisible) {
  if (layerType === "stops" && map.stopsLayer) map.stopsLayer.visible = isVisible;
  if (layerType === "route" && map.routeLayer) map.routeLayer.visible = isVisible;
  if (layerType === "fleet" && map.fleetLayer) map.fleetLayer.visible = isVisible;
}

// Xóa lộ trình và trạm đang vẽ
export function clearRouteGraphics() {
  if (map.routeLayer) map.routeLayer.removeAll();
  if (map.stopsLayer) map.stopsLayer.removeAll();
}
