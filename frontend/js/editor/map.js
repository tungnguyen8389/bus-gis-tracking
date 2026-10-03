// --------------------------------------------------------------------
// BẢN ĐỒ CHỈNH SỬA LỘ TRÌNH (ArcGIS SketchViewModel)
// --------------------------------------------------------------------
// Toạ độ trên bản đồ ở Web Mercator (theo basemap); chỉ đổi về WGS84 [lon, lat] khi phân tích / lưu.
let editorView, editLayer, overlayLayer, sketchVM;
let EditorGraphic, EditorPolyline, EditorPoint, editorWebMercator, editorGeometryEngine;
let pathGraphic = null;
let stopGraphics = [];

const PATH_SYMBOL = { type: "simple-line", color: [0, 122, 255, 0.9], width: 4 };
const GAP_SYMBOL = { type: "simple-line", color: [220, 38, 38, 0.85], width: 11 }; // Viền đỏ rộng nằm dưới lộ trình
const COORD_DECIMALS = 8; // Bằng độ chính xác dữ liệu gốc: đỉnh không sửa giữ nguyên giá trị khi lưu

function stopSymbol(isFar) {
  return {
    type: "simple-marker",
    size: 11,
    color: isFar ? [249, 115, 22, 1] : [255, 255, 255, 1],
    outline: { color: isFar ? [154, 52, 18, 1] : [0, 90, 145, 1], width: 2 }
  };
}

function initEditorMap(onReady) {
  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer",
    "esri/geometry/Polyline",
    "esri/geometry/Point",
    "esri/widgets/BasemapToggle",
    "esri/widgets/Sketch/SketchViewModel",
    "esri/geometry/support/webMercatorUtils",
    "esri/geometry/geometryEngine"
  ], function(EsriMap, MapView, Graphic, GraphicsLayer, Polyline, Point, BasemapToggle, SketchViewModel, webMercatorUtils, geometryEngine) {
    EditorGraphic = Graphic;
    EditorPolyline = Polyline;
    EditorPoint = Point;
    editorWebMercator = webMercatorUtils;
    editorGeometryEngine = geometryEngine;

    // Lớp sửa được (lộ trình + trạm) tách khỏi lớp tô đoạn lỗi để click không chọn nhầm
    editLayer = new GraphicsLayer({ title: "Đang chỉnh sửa" });
    overlayLayer = new GraphicsLayer({ title: "Đoạn nhảy xa" });
    const map = new EsriMap({ basemap: MAP_BASEMAP, layers: [overlayLayer, editLayer] });

    editorView = new MapView({
      container: "editorViewDiv",
      map: map,
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    });
    editorView.ui.add(new BasemapToggle({ view: editorView, nextBasemap: "satellite" }), "bottom-left");

    // Tự xử lý click để lộ trình luôn ở chế độ reshape (kéo đỉnh) và trạm ở chế độ move
    sketchVM = new SketchViewModel({
      view: editorView,
      layer: editLayer,
      updateOnGraphicClick: false,
      defaultUpdateOptions: { enableRotation: false, enableScaling: false, multipleSelectionEnabled: false, toggleToolOnClick: false }
    });

    // Khi đang sửa, SketchViewModel nuốt sự kiện click của view nên bắt click ở DOM (pha capture).
    // Bỏ qua click sinh ra sau khi kéo đỉnh / kéo bản đồ.
    const container = editorView.container;
    let pointerDownAt = null;
    container.addEventListener("pointerdown", e => { pointerDownAt = [e.clientX, e.clientY]; }, true);
    container.addEventListener("click", e => {
      if (!pointerDownAt || Math.hypot(e.clientX - pointerDownAt[0], e.clientY - pointerDownAt[1]) > 4) return;
      const rect = container.getBoundingClientRect();
      selectGraphicAt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }, true);

    editorView.when(() => onReady && onReady());
  });
}

async function selectGraphicAt(screenPoint) {
  const hit = await editorView.hitTest(screenPoint, { include: [editLayer] });
  const graphics = hit.results.map(r => r.graphic);
  // Trạm nhỏ và thường nằm đè lên lộ trình nên được ưu tiên chọn
  const graphic = graphics.find(g => g.attributes.kind === "stop") || graphics.find(g => g === pathGraphic);
  if (!graphic || graphic === sketchVM.updateGraphics.getItemAt(0)) return;
  startEditingGraphic(graphic);
}

function startEditingGraphic(graphic) {
  if (sketchVM.state === "active") sketchVM.complete();
  const options = graphic === pathGraphic
    ? { tool: "reshape", reshapeOptions: { edgeOperation: "split", shapeOperation: "none", vertexOperation: "move" } }
    : { tool: "move" };
  sketchVM.update(graphic, options);
}

function lonLatToView(lon, lat) {
  const [x, y] = editorWebMercator.lngLatToXY(lon, lat);
  return [x, y];
}

function viewToLonLat([x, y]) {
  const [lon, lat] = editorWebMercator.xyToLngLat(x, y);
  return [+lon.toFixed(COORD_DECIMALS), +lat.toFixed(COORD_DECIMALS)];
}

// Vẽ lộ trình ([[lon, lat], ...]) và danh sách trạm của tuyến lên lớp chỉnh sửa
function renderEditableRoute(pathLonLat, stops) {
  if (sketchVM.state === "active") sketchVM.cancel();
  editLayer.removeAll();
  overlayLayer.removeAll();

  pathGraphic = new EditorGraphic({
    geometry: new EditorPolyline({
      paths: [pathLonLat.map(([lon, lat]) => lonLatToView(lon, lat))],
      spatialReference: editorView.spatialReference
    }),
    symbol: PATH_SYMBOL,
    attributes: { kind: "path" }
  });

  stopGraphics = stops.map(s => {
    const [x, y] = lonLatToView(s.longitude, s.latitude);
    return new EditorGraphic({
      geometry: new EditorPoint({ x, y, spatialReference: editorView.spatialReference }),
      symbol: stopSymbol(false),
      attributes: { kind: "stop", stop_id: s.stop_id, stop_name: s.stop_name, address: s.address, stop_order: s.stop_order }
    });
  });

  editLayer.add(pathGraphic);
  editLayer.addMany(stopGraphics);
  editorView.goTo(pathGraphic.geometry.extent.clone().expand(1.15), { duration: 600 }).catch(() => {});
}

function clearEditableRoute() {
  if (sketchVM.state === "active") sketchVM.cancel();
  editLayer.removeAll();
  overlayLayer.removeAll();
  pathGraphic = null;
  stopGraphics = [];
}

// --------------------------------------------------------------------
// ẢNH CHỤP TRẠNG THÁI (dùng cho hoàn tác / so sánh với bản đã lưu)
// --------------------------------------------------------------------
// Toạ độ giữ nguyên hệ của bản đồ để khôi phục không bị sai số làm tròn.
// Trạm lưu theo thứ tự trong stopGraphics (tuyến vòng có thể ghé cùng một trạm 2 lần).
function takeSnapshot() {
  return {
    path: pathGraphic.geometry.paths.flat().map(([x, y]) => [x, y]),
    stops: stopGraphics.map(g => [g.geometry.x, g.geometry.y])
  };
}

function applySnapshot(snapshot) {
  pathGraphic.geometry = new EditorPolyline({ paths: [snapshot.path], spatialReference: editorView.spatialReference });
  stopGraphics.forEach((g, i) => {
    const [x, y] = snapshot.stops[i];
    g.geometry = new EditorPoint({ x, y, spatialReference: editorView.spatialReference });
  });
}

function sameSnapshot(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pathChangedBetween(a, b) {
  return JSON.stringify(a.path) !== JSON.stringify(b.path);
}

function stopMovedBetween(a, b, index) {
  const [ax, ay] = a.stops[index];
  const [bx, by] = b.stops[index];
  return ax !== bx || ay !== by;
}

// --------------------------------------------------------------------
// ĐIỀU HƯỚNG
// --------------------------------------------------------------------
function zoomToLonLatSegment(from, to) {
  const line = new EditorPolyline({
    paths: [[lonLatToView(...from), lonLatToView(...to)]],
    spatialReference: editorView.spatialReference
  });
  editorView.goTo(line.extent.clone().expand(1.6), { duration: 500 }).catch(() => {});
}

function zoomToStopGraphic(graphic) {
  editorView.goTo({ target: graphic.geometry, zoom: Math.max(editorView.zoom, 17) }, { duration: 500 }).catch(() => {});
}
