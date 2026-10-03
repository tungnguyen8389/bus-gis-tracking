// --------------------------------------------------------------------
// KHỞI TẠO BẢN ĐỒ ARCGIS 2D
// --------------------------------------------------------------------
let mapView, routeLayer, stopsLayer, fleetLayer, GraphicClass, PointClass;

function initMap(onReady) {
  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer",
    "esri/geometry/Point",
    "esri/widgets/BasemapToggle"
  ], function(EsriMap, MapView, Graphic, GraphicsLayer, Point, BasemapToggle) {
    GraphicClass = Graphic;
    PointClass = Point;

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

    if (onReady) onReady();
  });
}

// --------------------------------------------------------------------
// BẬT / TẮT LỚP HIỂN THỊ
// --------------------------------------------------------------------
function toggleLayer(layerType, isVisible) {
  const layers = { stops: stopsLayer, route: routeLayer, fleet: fleetLayer };
  const layer = layers[layerType];
  if (layer) layer.visible = isVisible;
}
