// --------------------------------------------------------------------
// KHỞI TẠO BẢN ĐỒ ARCGIS 2D
// --------------------------------------------------------------------
let mapView, routeLayer, stopsLayer, fleetLayer, GraphicClass, PointClass, webMercatorUtilsModule;

function initMap(onReady) {
  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer",
    "esri/geometry/Point",
    "esri/widgets/BasemapToggle",
    "esri/core/reactiveUtils",
    "esri/geometry/support/webMercatorUtils"
  ], function(EsriMap, MapView, Graphic, GraphicsLayer, Point, BasemapToggle, reactiveUtils, webMercatorUtils) {
    GraphicClass = Graphic;
    PointClass = Point;
    webMercatorUtilsModule = webMercatorUtils;

    // 1. Khởi tạo 75% màn hình ở giữa là khung Bản đồ số 2D ArcGIS
    const map = new EsriMap({ basemap: MAP_BASEMAP });

    mapView = new MapView({
      container: "viewDiv",
      map: map,
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    });

    // Nút chuyển đổi nhanh ảnh Vệ tinh
    const basemapToggle = new BasemapToggle({ view: mapView, nextBasemap: "satellite" });
    mapView.ui.add(basemapToggle, "bottom-left");

    // 2. Tạo các Layer riêng biệt để quản lý
    routeLayer = new GraphicsLayer({ title: "Lộ trình tim đường" });
    stopsLayer = new GraphicsLayer({ title: "Trạm đón trả khách" });
    fleetLayer = new GraphicsLayer({ title: "Đội xe buýt Realtime" });
    map.addMany([routeLayer, stopsLayer, fleetLayer]);

    // 3. Mỗi khi người dùng dừng kéo / zoom bản đồ
    reactiveUtils.when(() => mapView.stationary, () => onMapStationary());

    if (onReady) onReady();
  });
}

// Khung nhìn hiện tại theo WGS84: [minLon, minLat, maxLon, maxLat]
function getViewBboxWgs84() {
  if (!mapView || !mapView.extent) return null;
  let extent = mapView.extent;
  if (extent.spatialReference.isWebMercator) {
    extent = webMercatorUtilsModule.webMercatorToGeographic(extent);
  }
  return [extent.xmin, extent.ymin, extent.xmax, extent.ymax].map(v => +v.toFixed(6));
}

// --------------------------------------------------------------------
// BẬT / TẮT LỚP HIỂN THỊ
// --------------------------------------------------------------------
function toggleLayer(layerType, isVisible) {
  const layers = { stops: stopsLayer, route: routeLayer, fleet: fleetLayer };
  const layer = layers[layerType];
  if (layer) layer.visible = isVisible;
}
