// --------------------------------------------------------------------
// NHẬP / XUẤT JSON TỌA ĐỘ VÀ DỮ LIỆU (ĐỒNG BỘ get_coords_1.html)
// --------------------------------------------------------------------
let previewMap, previewView, previewLayer, GraphicClass;

// Khởi tạo ArcGIS Preview Map
function initPreviewMap() {
  require([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer"
  ], function(EsriMap, MapView, Graphic, GraphicsLayer) {
    GraphicClass = Graphic;
    previewMap = new EsriMap({ basemap: MAP_BASEMAP });
    previewView = new MapView({
      container: "previewMapDiv",
      map: previewMap,
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    });
    previewLayer = new GraphicsLayer();
    previewMap.add(previewLayer);
  });
}

async function loadRoutesForImport() {
  try {
    await ensureRoutesLoaded();
    fillRouteSelect(document.getElementById("import_route_id"));
  } catch (e) {}
}

// Gợi ý cấu trúc JSON hiển thị trong textarea theo loại dữ liệu
const IMPORT_PLACEHOLDERS = {
  full_package: `{\n  "routeName": "Tuyen_19_Ben_Thanh_DHQG",\n  "totalStops": 12,\n  "totalPathPoints": 150,\n  "stops": [\n    { "id": 1, "name": "Bến xe buýt Sài Gòn", "geometry": { "type": "Point", "coordinates": [106.70216, 10.77125] } }\n  ],\n  "routeGeometry": {\n    "type": "LineString",\n    "coordinates": [[106.70216, 10.77125], [106.70138, 10.78712]]\n  }\n}`,
  route_path: `[\n  [106.795000, 10.863000],\n  [106.798000, 10.866000],\n  [106.800000, 10.870000]\n]`,
  stops: `[\n  {\n    "stt": 1,\n    "name": "Trạm KTX Khu A",\n    "coords_arcgis_wgs84": [106.795, 10.863]\n  }\n]`,
  vehicles: `[\n  { "vehicle_id": "BUS_51B_03", "plate_number": "51B-888.99", "capacity": 45, "driver_name": "Nguyễn Văn C", "status": "ACTIVE" }\n]`
};

// Các loại import cần chọn tuyến & chiều
const ROUTE_SCOPED_IMPORT_TYPES = ["auto", "full_package", "route_path", "stops"];

function handleImportTypeChange() {
  const type = document.getElementById("import_type").value;

  // Hiển thị chọn tuyến và chiều khi nạp auto, full_package, route_path hoặc stops
  document.getElementById("import_route_options").style.display =
    ROUTE_SCOPED_IMPORT_TYPES.includes(type) ? "block" : "none";

  if (IMPORT_PLACEHOLDERS[type]) {
    document.getElementById("import_json_textarea").placeholder = IMPORT_PLACEHOLDERS[type];
  }
}

// Nhận diện cấu trúc JSON: full_package | route_path | stops | geojson | null
function detectJsonFormat(data) {
  if (data.routeGeometry && data.stops) return "full_package";
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && typeof data[0][0] === "number") return "route_path";
  if (Array.isArray(data) && data.length > 0 && (data[0].coords_arcgis_wgs84 || data[0].coords || data[0].name || data[0].stop_name)) return "stops";
  if (data.type === "FeatureCollection") return "geojson";
  return null;
}

function setFormatBadge(badge, html, background, color) {
  badge.innerHTML = html;
  badge.style.background = background;
  badge.style.color = color;
}

// Thử tìm tuyến khớp với routeName của gói trọn gói
function autoSelectRouteByName(routeName) {
  if (!routeName || globalRoutes.length === 0) return;
  const clean = routeName.toLowerCase().replace(/_/g, " ");
  const matched = globalRoutes.find(r => clean.includes(r.route_number.toLowerCase()) || r.route_name.toLowerCase().includes(clean));
  if (matched) {
    document.getElementById("import_route_id").value = matched.route_id;
  }
}

function onJsonInputChanged() {
  const rawText = document.getElementById("import_json_textarea").value.trim();
  const badge = document.getElementById("detected-format-badge");
  if (!rawText) {
    setFormatBadge(badge, "Chờ dữ liệu...", "#e2e8f0", "#475569");
    return;
  }

  try {
    const data = JSON.parse(rawText);
    switch (detectJsonFormat(data)) {
      case "full_package":
        setFormatBadge(badge, `📦 Gói Trọn Gói (${data.stops.length} trạm, ${data.routeGeometry.coordinates?.length || 0} điểm lộ trình)`, "#dcfce7", "#15803d");
        autoSelectRouteByName(data.routeName);
        break;
      case "route_path":
        setFormatBadge(badge, `🛣️ Lộ trình routeJson (${data.length} điểm tọa độ)`, "#e0f2fe", "#0369a1");
        break;
      case "stops":
        setFormatBadge(badge, `📍 Trạm dừng stopsJson (${data.length} trạm)`, "#fef3c7", "#b45309");
        break;
      case "geojson":
        setFormatBadge(badge, `🌐 GeoJSON FeatureCollection (${data.features?.length || 0} đối tượng)`, "#f3e8ff", "#7e22ce");
        break;
      default:
        setFormatBadge(badge, `✓ Dữ liệu JSON hợp lệ`, "#f1f5f9", "#334155");
    }
  } catch (err) {
    setFormatBadge(badge, `⚠️ Cú pháp JSON chưa hợp lệ`, "#fee2e2", "#b91c1c");
  }
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    document.getElementById("import_json_textarea").value = evt.target.result;
    onJsonInputChanged();
    previewJsonOnMap();
  };
  reader.readAsText(file);
}

// Lấy [lon, lat] của một trạm ở nhiều định dạng (GeoJSON, coords_arcgis_wgs84, coords, longitude/latitude, mảng)
function extractStopLonLat(st) {
  if (st.geometry) return [st.geometry.coordinates[0], st.geometry.coordinates[1]];
  if (st.coords_arcgis_wgs84) return [st.coords_arcgis_wgs84[0], st.coords_arcgis_wgs84[1]];
  if (st.coords) return [st.coords[0], st.coords[1]];
  return [st.longitude || st[0], st.latitude || st[1]];
}

function createPreviewPolyline(coords) {
  return new GraphicClass({
    geometry: { type: "polyline", paths: coords },
    symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 4 }
  });
}

function setPreviewInfo(html, color = "#16a34a") {
  document.getElementById("preview-info").innerHTML = `<span style="color: ${color}; font-weight: 600;">${html}</span>`;
}

// 1. Xem trước gói Trọn gói (Cả Polyline + Trạm dừng từ get_coords_1.html)
function previewFullPackage(data, allPreviewPoints) {
  const routeCoords = data.routeGeometry?.coordinates || [];
  const stopsList = data.stops || [];

  if (routeCoords.length >= 2) {
    previewLayer.add(createPreviewPolyline(routeCoords));
    routeCoords.forEach(c => allPreviewPoints.push(c));
  }

  stopsList.forEach((st, idx) => {
    const [lon, lat] = extractStopLonLat(st);
    const name = st.name || st.stop_name || `Trạm ${idx + 1}`;
    const stt = st.id || st.stt || (idx + 1);

    if (lon && lat) {
      allPreviewPoints.push([lon, lat]);
      previewLayer.add(new GraphicClass({
        geometry: { type: "point", longitude: lon, latitude: lat },
        symbol: {
          type: "simple-marker",
          color: [255, 87, 34],
          size: "12px",
          outline: { color: [255, 255, 255], width: 2 }
        },
        popupTemplate: {
          title: `[#${stt}] ${name}`,
          content: `<div style="font-size: 13px;"><b>Tọa độ:</b> ${lat.toFixed(6)}, ${lon.toFixed(6)}<br><b>Tuyến:</b> ${data.routeName || "Chưa đặt tên"}</div>`
        }
      }));
    }
  });

  if (allPreviewPoints.length > 0) {
    previewView.goTo(allPreviewPoints, { duration: 800 });
  }
  setPreviewInfo(`✓ Trực quan hóa Gói Trọn Gói: <b>${stopsList.length}</b> trạm dừng (chấm cam) và <b>${routeCoords.length}</b> điểm lộ trình (đường xanh dương).`);
}

// 2. Xem trước Tọa độ Lộ trình tim đường (routeJson)
function previewRoutePath(data) {
  const coords = Array.isArray(data) ? data : (data.geometry?.coordinates || data.coordinates || data.routeGeometry?.coordinates);
  if (!coords || coords.length < 2) throw new Error("Cần mảng ít nhất 2 tọa độ [lon, lat]");

  previewLayer.add(createPreviewPolyline(coords));
  previewView.goTo(coords, { duration: 800 });
  setPreviewInfo(`✓ Đã hiển thị lộ trình với <b>${coords.length}</b> điểm tọa độ tim đường.`);
}

// 3. Xem trước Danh sách Trạm dừng (stopsJson)
function previewStops(data, allPreviewPoints) {
  const list = data.features || (Array.isArray(data) ? data : []);
  list.forEach((st, idx) => {
    const [lon, lat] = extractStopLonLat(st);
    const name = st.properties?.stop_name || st.name || st.stop_name || `Trạm ${idx + 1}`;
    const stt = st.stt || st.id || (idx + 1);

    if (lon && lat) {
      allPreviewPoints.push([lon, lat]);
      previewLayer.add(new GraphicClass({
        geometry: { type: "point", longitude: lon, latitude: lat },
        symbol: { type: "simple-marker", color: [0, 150, 136], size: "11px", outline: { color: [255, 255, 255], width: 1.5 } },
        popupTemplate: { title: `[#${stt}] ${name}`, content: `Kinh độ: ${lon}, Vĩ độ: ${lat}` }
      }));
    }
  });
  if (allPreviewPoints.length > 0) {
    previewView.goTo(allPreviewPoints, { duration: 800 });
  }
  setPreviewInfo(`✓ Đã hiển thị <b>${list.length}</b> trạm dừng trên bản đồ.`);
}

function previewJsonOnMap() {
  let type = document.getElementById("import_type").value;
  const rawText = document.getElementById("import_json_textarea").value.trim();

  if (!rawText) return alert("Vui lòng dán hoặc tải file JSON trước khi xem trước!");

  try {
    const data = JSON.parse(rawText);
    if (previewLayer) previewLayer.removeAll();

    // Tự động nhận diện cấu trúc nếu đang để 'auto' (GeoJSON được xem như danh sách trạm)
    if (type === "auto") {
      const detected = detectJsonFormat(data);
      if (detected) type = detected === "geojson" ? "stops" : detected;
    }

    const allPreviewPoints = [];

    if (type === "full_package" || (data.routeGeometry && data.stops)) {
      previewFullPackage(data, allPreviewPoints);
    } else if (type === "route_path") {
      previewRoutePath(data);
    } else if (type === "stops") {
      previewStops(data, allPreviewPoints);
    } else {
      setPreviewInfo(`✓ Cấu trúc JSON '${type}' hợp lệ. Sẵn sàng lưu vào CSDL.`, "#0284c7");
    }
  } catch (err) {
    setPreviewInfo(`✗ Lỗi cú pháp JSON: ${err.message}`, "#dc2626");
    alert("Lỗi cú pháp JSON: " + err.message);
  }
}

async function submitImportJson() {
  const type = document.getElementById("import_type").value;
  const rawText = document.getElementById("import_json_textarea").value.trim();
  const route_id = document.getElementById("import_route_id").value;
  const direction = document.getElementById("import_direction").value;

  if (!rawText) return alert("Vui lòng dán hoặc tải lên file JSON cần import!");

  try {
    JSON.parse(rawText);
  } catch (e) {
    return alert("Cú pháp JSON không hợp lệ: " + e.message);
  }

  if (!confirm(`Xác nhận cập nhật dữ liệu vào CSDL (Loại: '${type}')?`)) return;

  try {
    const res = await apiRequest("POST", "/import/json", { type, route_id, direction, data: rawText });
    const data = await res.json();
    if (res.ok) {
      let extraMsg = "";
      if (data.details) {
        if (data.details.path_points) extraMsg += ` | Lộ trình: ${data.details.path_points} điểm`;
        if (data.details.stops_count) extraMsg += ` | Trạm dừng: ${data.details.stops_count} trạm`;
      }
      alert(`🎉 THÀNH CÔNG!\n${data.message}${extraMsg}`);
      document.getElementById("import_json_textarea").value = "";
      onJsonInputChanged();
      loadDashboardStats();
    } else {
      alert("❌ Lỗi: " + (data.error || "Không thể import"));
    }
  } catch (err) {
    alert("❌ Lỗi kết nối máy chủ: " + err.message);
  }
}

function exportData(type) {
  window.open(`${API_BASE}/export/json?type=${type}`, "_blank");
}
