// --------------------------------------------------------------------
// Tab NHẬP / XUẤT JSON TỌA ĐỘ VÀ DỮ LIỆU (ĐỒNG BỘ get_coords_1.html)
// --------------------------------------------------------------------
import { state, preview } from "../admin.state.js";
import { loadArcgisModules } from "../../../core/arcgis.js";
import { ApiError } from "../../../core/http.js";
import { loadDashboardStats } from "./dashboard.js";
import { ensureRoutesLoaded, routeOptionsHtml } from "./routes.js";
import { importJson, exportJsonUrl, detectImportType } from "../../../modules/import-export/import-export.service.js";

// Khởi tạo ArcGIS Preview Map
export async function initPreviewMap() {
  const [EsriMap, MapView, Graphic, GraphicsLayer] = await loadArcgisModules([
    "esri/Map",
    "esri/views/MapView",
    "esri/Graphic",
    "esri/layers/GraphicsLayer"
  ]);
  preview.Graphic = Graphic;
  const previewMap = new EsriMap({ basemap: "streets-navigation-vector" });
  preview.view = new MapView({
    container: "previewMapDiv",
    map: previewMap,
    center: [106.80196, 10.87052],
    zoom: 14
  });
  preview.layer = new GraphicsLayer();
  previewMap.add(preview.layer);
}

// Gọi khi mở tab: bản đồ nằm trong tab ẩn nên cần resize lại
export function onJsonHubShown() {
  loadRoutesForImport();
  setTimeout(() => preview.view && preview.view.container && preview.view.resize(), 200);
}

async function loadRoutesForImport() {
  try {
    await ensureRoutesLoaded();
    document.getElementById("import_route_id").innerHTML = routeOptionsHtml();
  } catch (e) {}
}

export function handleImportTypeChange() {
  const type = document.getElementById("import_type").value;
  const routeOptions = document.getElementById("import_route_options");

  // Hiển thị chọn tuyến và chiều khi nạp auto, full_package, route_path hoặc stops
  if (type === "auto" || type === "full_package" || type === "route_path" || type === "stops") {
    routeOptions.style.display = "block";
  } else {
    routeOptions.style.display = "none";
  }

  const textarea = document.getElementById("import_json_textarea");
  if (type === "full_package") {
    textarea.placeholder = `{\n  "routeName": "Tuyen_19_Ben_Thanh_DHQG",\n  "totalStops": 12,\n  "totalPathPoints": 150,\n  "stops": [\n    { "id": 1, "name": "Bến xe buýt Sài Gòn", "geometry": { "type": "Point", "coordinates": [106.70216, 10.77125] } }\n  ],\n  "routeGeometry": {\n    "type": "LineString",\n    "coordinates": [[106.70216, 10.77125], [106.70138, 10.78712]]\n  }\n}`;
  } else if (type === "route_path") {
    textarea.placeholder = `[\n  [106.795000, 10.863000],\n  [106.798000, 10.866000],\n  [106.800000, 10.870000]\n]`;
  } else if (type === "stops") {
    textarea.placeholder = `[\n  {\n    "stt": 1,\n    "name": "Trạm KTX Khu A",\n    "coords_arcgis_wgs84": [106.795, 10.863]\n  }\n]`;
  } else if (type === "vehicles") {
    textarea.placeholder = `[\n  { "vehicle_id": "BUS_51B_03", "plate_number": "51B-888.99", "capacity": 45, "driver_name": "Nguyễn Văn C", "status": "ACTIVE" }\n]`;
  }
}

function setBadge(html, background, color) {
  const badge = document.getElementById("detected-format-badge");
  badge.innerHTML = html;
  badge.style.background = background;
  badge.style.color = color;
}

export function onJsonInputChanged() {
  const rawText = document.getElementById("import_json_textarea").value.trim();
  if (!rawText) {
    setBadge("Chờ dữ liệu...", "#e2e8f0", "#475569");
    return;
  }

  try {
    const data = JSON.parse(rawText);
    if (data.routeGeometry && data.stops) {
      setBadge(`📦 Gói Trọn Gói (${data.stops.length} trạm, ${data.routeGeometry.coordinates?.length || 0} điểm lộ trình)`, "#dcfce7", "#15803d");

      // Thử tìm khớp tuyến nếu có routeName
      if (data.routeName && state.routes.length > 0) {
        const clean = data.routeName.toLowerCase().replace(/_/g, " ");
        const matched = state.routes.find(r => clean.includes(r.route_number.toLowerCase()) || r.route_name.toLowerCase().includes(clean));
        if (matched) {
          document.getElementById("import_route_id").value = matched.route_id;
        }
      }
    } else if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && typeof data[0][0] === "number") {
      setBadge(`🛣️ Lộ trình routeJson (${data.length} điểm tọa độ)`, "#e0f2fe", "#0369a1");
    } else if (Array.isArray(data) && data.length > 0 && (data[0].coords_arcgis_wgs84 || data[0].coords || data[0].name || data[0].stop_name)) {
      setBadge(`📍 Trạm dừng stopsJson (${data.length} trạm)`, "#fef3c7", "#b45309");
    } else if (data.type === "FeatureCollection") {
      setBadge(`🌐 GeoJSON FeatureCollection (${data.features?.length || 0} đối tượng)`, "#f3e8ff", "#7e22ce");
    } else {
      setBadge(`✓ Dữ liệu JSON hợp lệ`, "#f1f5f9", "#334155");
    }
  } catch (err) {
    setBadge(`⚠️ Cú pháp JSON chưa hợp lệ`, "#fee2e2", "#b91c1c");
  }
}

export function handleFileUpload(e) {
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

export function previewJsonOnMap() {
  let type = document.getElementById("import_type").value;
  const rawText = document.getElementById("import_json_textarea").value.trim();
  const infoEl = document.getElementById("preview-info");
  const Graphic = preview.Graphic;

  if (!rawText) return alert("Vui lòng dán hoặc tải file JSON trước khi xem trước!");

  try {
    const data = JSON.parse(rawText);
    if (preview.layer) preview.layer.removeAll();

    // Tự động nhận diện cấu trúc nếu đang để 'auto'
    if (type === "auto") type = detectImportType(data) || type;

    const allPreviewPoints = [];

    // 1. Xem trước gói Trọn gói (Cả Polyline + Trạm dừng từ get_coords_1.html)
    if (type === "full_package" || (data.routeGeometry && data.stops)) {
      const routeCoords = data.routeGeometry?.coordinates || [];
      const stopsList = data.stops || [];

      if (routeCoords.length >= 2) {
        const polylineGraphic = new Graphic({
          geometry: { type: "polyline", paths: routeCoords },
          symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 4 }
        });
        preview.layer.add(polylineGraphic);
        routeCoords.forEach(c => allPreviewPoints.push(c));
      }

      stopsList.forEach((st, idx) => {
        const lon = st.geometry ? st.geometry.coordinates[0] : (st.coords_arcgis_wgs84 ? st.coords_arcgis_wgs84[0] : (st.coords ? st.coords[0] : st.longitude));
        const lat = st.geometry ? st.geometry.coordinates[1] : (st.coords_arcgis_wgs84 ? st.coords_arcgis_wgs84[1] : (st.coords ? st.coords[1] : st.latitude));
        const name = st.name || st.stop_name || `Trạm ${idx + 1}`;
        const stt = st.id || st.stt || (idx + 1);

        if (lon && lat) {
          allPreviewPoints.push([lon, lat]);
          const pointGraphic = new Graphic({
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
          });
          preview.layer.add(pointGraphic);
        }
      });

      if (allPreviewPoints.length > 0) {
        preview.view.goTo(allPreviewPoints, { duration: 800 });
      }
      infoEl.innerHTML = `<span style="color: #16a34a; font-weight: 600;">✓ Trực quan hóa Gói Trọn Gói: <b>${stopsList.length}</b> trạm dừng (chấm cam) và <b>${routeCoords.length}</b> điểm lộ trình (đường xanh dương).</span>`;
    }

    // 2. Xem trước Tọa độ Lộ trình tim đường (routeJson)
    else if (type === "route_path") {
      let coords = Array.isArray(data) ? data : (data.geometry?.coordinates || data.coordinates || data.routeGeometry?.coordinates);
      if (!coords || coords.length < 2) throw new Error("Cần mảng ít nhất 2 tọa độ [lon, lat]");

      const polylineGraphic = new Graphic({
        geometry: { type: "polyline", paths: coords },
        symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 4 }
      });
      preview.layer.add(polylineGraphic);
      preview.view.goTo(coords, { duration: 800 });
      infoEl.innerHTML = `<span style="color: #16a34a; font-weight: 600;">✓ Đã hiển thị lộ trình với <b>${coords.length}</b> điểm tọa độ tim đường.</span>`;
    }

    // 3. Xem trước Danh sách Trạm dừng (stopsJson)
    else if (type === "stops") {
      let list = data.features || (Array.isArray(data) ? data : []);
      list.forEach((st, idx) => {
        const lon = st.geometry ? st.geometry.coordinates[0] : (st.coords_arcgis_wgs84 ? st.coords_arcgis_wgs84[0] : (st.coords ? st.coords[0] : (st.longitude || st[0])));
        const lat = st.geometry ? st.geometry.coordinates[1] : (st.coords_arcgis_wgs84 ? st.coords_arcgis_wgs84[1] : (st.coords ? st.coords[1] : (st.latitude || st[1])));
        const name = st.properties?.stop_name || st.name || st.stop_name || `Trạm ${idx + 1}`;
        const stt = st.stt || st.id || (idx + 1);

        if (lon && lat) {
          allPreviewPoints.push([lon, lat]);
          const pointGraphic = new Graphic({
            geometry: { type: "point", longitude: lon, latitude: lat },
            symbol: { type: "simple-marker", color: [0, 150, 136], size: "11px", outline: { color: [255, 255, 255], width: 1.5 } },
            popupTemplate: { title: `[#${stt}] ${name}`, content: `Kinh độ: ${lon}, Vĩ độ: ${lat}` }
          });
          preview.layer.add(pointGraphic);
        }
      });
      if (allPreviewPoints.length > 0) {
        preview.view.goTo(allPreviewPoints, { duration: 800 });
      }
      infoEl.innerHTML = `<span style="color: #16a34a; font-weight: 600;">✓ Đã hiển thị <b>${list.length}</b> trạm dừng trên bản đồ.</span>`;
    } else {
      infoEl.innerHTML = `<span style="color: #0284c7; font-weight: 600;">✓ Cấu trúc JSON '${type}' hợp lệ. Sẵn sàng lưu vào CSDL.</span>`;
    }
  } catch (err) {
    infoEl.innerHTML = `<span style="color: #dc2626; font-weight: 600;">✗ Lỗi cú pháp JSON: ${err.message}</span>`;
    alert("Lỗi cú pháp JSON: " + err.message);
  }
}

export async function submitImportJson() {
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
    const data = await importJson({ type, route_id, direction, data: rawText });
    let extraMsg = "";
    if (data.details) {
      if (data.details.path_points) extraMsg += ` | Lộ trình: ${data.details.path_points} điểm`;
      if (data.details.stops_count) extraMsg += ` | Trạm dừng: ${data.details.stops_count} trạm`;
    }
    alert(`🎉 THÀNH CÔNG!\n${data.message}${extraMsg}`);
    document.getElementById("import_json_textarea").value = "";
    onJsonInputChanged();
    loadDashboardStats();
  } catch (err) {
    if (err instanceof ApiError) alert("❌ Lỗi: " + ((err.data && err.data.error) || "Không thể import"));
    else alert("❌ Lỗi kết nối máy chủ: " + err.message);
  }
}

export function exportData(type) {
  window.open(exportJsonUrl(type), "_blank");
}
