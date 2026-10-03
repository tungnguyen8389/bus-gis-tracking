// --------------------------------------------------------------------
// NẠP DANH SÁCH TUYẾN & XỬ LÝ CHỌN TUYẾN
// --------------------------------------------------------------------
let allRoutes = [];
let currentRawStops = [];
let currentSelectedRoute = "ALL";
let currentDirection = 1;

async function loadRoutesList() {
  try {
    const res = await fetch(`${API_BASE}/routes`);
    allRoutes = await res.json();

    const select = document.getElementById("routeSelect");
    select.innerHTML = `<option value="ALL">🌐 Hiển thị Tất cả các Tuyến</option>` + routeOptionsHtml(allRoutes);

    document.getElementById("routeCountBadge").innerText = `${allRoutes.length} tuyến`;

    if (allRoutes.length > 0) {
      select.value = allRoutes[0].route_id;
      onRouteChanged();
    } else {
      loadAllRoutesAndStops();
    }
  } catch (err) {
    console.warn("Lỗi tải tuyến xe:", err);
  }
}

function setDirection(dir) {
  currentDirection = dir;
  document.getElementById("btnDir1").classList.toggle("active", dir === 1);
  document.getElementById("btnDir2").classList.toggle("active", dir === 2);
  onRouteChanged();
}

function renderRouteInfo(name, distance, headway) {
  document.getElementById("routeNameDisplay").innerText = name;
  document.getElementById("routeDistanceDisplay").innerText = distance;
  document.getElementById("routeHeadwayDisplay").innerText = headway;
}

async function onRouteChanged() {
  currentSelectedRoute = document.getElementById("routeSelect").value;
  const dirGroup = document.getElementById("directionGroup");

  if (currentSelectedRoute === "ALL") {
    dirGroup.style.display = "none";
    renderRouteInfo("Tất cả các tuyến trong hệ thống", "-- km", "-- phút");
    loadAllRoutesAndStops();
  } else {
    dirGroup.style.display = "block";
    const route = allRoutes.find(r => r.route_id === currentSelectedRoute);
    if (route) {
      renderRouteInfo(`Tuyến ${route.route_number} - ${route.route_name}`, `${route.distance_km} km`, `${route.headway_min} phút`);
    }
    loadSingleRouteData(currentSelectedRoute, currentDirection);
  }

  // Cập nhật hiển thị xe buýt tức thì phù hợp với tuyến đang chọn
  Object.values(busGraphics).forEach(g => {
    if (g && g.attributes) {
      g.visible = isRouteSelected(g.attributes.route_id);
    }
  });
}

// Xe/tuyến có thuộc bộ lọc tuyến đang chọn không
function isRouteSelected(routeId) {
  return currentSelectedRoute === "ALL" || routeId === currentSelectedRoute;
}

function clearRouteAndStopLayers() {
  if (!routeLayer || !stopsLayer) return false;
  routeLayer.removeAll();
  stopsLayer.removeAll();
  return true;
}

async function loadSingleRouteData(routeId, direction) {
  if (!clearRouteAndStopLayers()) return;

  // 1. Tải lộ trình
  try {
    const pathRes = await fetch(`${API_BASE}/routes/${routeId}/path?direction=${direction}`);
    if (pathRes.ok) {
      const pathGeoJson = await pathRes.json();
      const coords = pathGeoJson.geometry.coordinates;

      const routePolyline = new GraphicClass({
        geometry: { type: "polyline", paths: coords },
        symbol: { type: "simple-line", color: [0, 122, 255, 0.9], width: 5 }
      });
      routeLayer.add(routePolyline);

      if (mapView && coords.length > 0) {
        // Chờ MapView sẵn sàng (auto-login có thể nạp tuyến trước khi view khởi tạo xong)
        mapView.when(() => mapView.goTo(coords, { duration: 800 })).catch(() => {});
      }
    }
  } catch (e) {}

  // 2. Tải danh sách trạm
  try {
    const stopsRes = await fetch(`${API_BASE}/routes/${routeId}/stops?direction=${direction}`);
    if (stopsRes.ok) {
      currentRawStops = await stopsRes.json();
      renderStopsList(currentRawStops);
    }
  } catch (e) {}
}

// Chuyển Feature GeoJSON của /stops thành bản ghi trạm dùng cho danh sách & marker
function featureToStop(f, idx) {
  return {
    ...f.properties,
    stop_order: idx + 1,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1]
  };
}

// Chế độ "Tất cả các tuyến": chỉ tải trạm trong khung nhìn khi đã phóng đủ gần
async function loadAllRoutesAndStops() {
  if (!clearRouteAndStopLayers()) return;

  if (!mapView || mapView.zoom < MAP_STOPS_MIN_ZOOM) {
    currentRawStops = [];
    renderStopsList([], "🔍 Phóng to bản đồ hoặc gõ tên trạm để xem trạm dừng");
    return;
  }

  const bbox = getViewBboxWgs84();
  if (!bbox) return;
  try {
    const res = await fetch(`${API_BASE}/stops?bbox=${bbox.join(",")}&limit=${MAP_STOPS_VIEW_LIMIT}`);
    const data = await res.json();
    if (currentSelectedRoute !== "ALL") return; // người dùng đã đổi tuyến trong lúc chờ
    currentRawStops = (data.features || []).map(featureToStop);
    renderStopsList(currentRawStops);
  } catch (e) {}
}

// Bản đồ dừng kéo / zoom: nạp lại trạm theo khung nhìn mới (chỉ ở chế độ "Tất cả")
let skipViewReloadUntil = 0;
function onMapStationary() {
  if (Date.now() < skipViewReloadUntil) return;
  const keyword = document.getElementById("stopSearchInput").value.trim();
  if (currentSelectedRoute === "ALL" && !keyword) {
    loadAllRoutesAndStops();
  }
}

// --------------------------------------------------------------------
// TÌM KIẾM TRẠM DỪNG & RENDER DANH SÁCH
// --------------------------------------------------------------------
const searchStopsOnServer = debounce(async keyword => {
  try {
    const res = await fetch(`${API_BASE}/stops?q=${encodeURIComponent(keyword)}&limit=${STOPS_SEARCH_LIMIT}`);
    const data = await res.json();
    if (document.getElementById("stopSearchInput").value.trim() !== keyword) return; // đã gõ tiếp
    renderStopsList((data.features || []).map(featureToStop));
  } catch (e) {}
}, 300);

function filterStops() {
  const keyword = document.getElementById("stopSearchInput").value.trim();

  // Chế độ "Tất cả": tìm trên toàn hệ thống qua server
  if (currentSelectedRoute === "ALL") {
    if (keyword) searchStopsOnServer(keyword);
    else loadAllRoutesAndStops();
    return;
  }

  if (!keyword) {
    renderStopsList(currentRawStops);
    return;
  }
  const lower = keyword.toLowerCase();
  const matches = value => value && value.toLowerCase().includes(lower);
  const filtered = currentRawStops.filter(s => matches(s.stop_name) || matches(s.address) || matches(s.stop_id) || matches(s.stop_code));
  renderStopsList(filtered);
}

function isStopActive(st) {
  return !st.status || st.status === STOP_STATUS_ACTIVE;
}

function stopPopupHtml(st) {
  const statusColor = isStopActive(st) ? "#15803d" : "#b91c1c";
  return `<b>Mã trạm:</b> ${st.stop_code || st.stop_id} <span style="color:#94a3b8;">(ID ${st.stop_id})</span><br>` +
    `<b>Loại trạm:</b> ${st.stop_type || "---"}<br>` +
    `<b>Trạng thái:</b> <span style="color:${statusColor}; font-weight:600;">${st.status || STOP_STATUS_ACTIVE}</span><br>` +
    `<b>Địa chỉ:</b> ${st.address || "---"}<br>` +
    `<b>Tọa độ:</b> [${st.longitude}, ${st.latitude}]`;
}

function createStopGraphic(st, order) {
  return new GraphicClass({
    geometry: { type: "point", longitude: st.longitude, latitude: st.latitude },
    symbol: {
      type: "simple-marker",
      // Trạm không còn khai thác hiển thị màu xám
      color: isStopActive(st) ? [0, 150, 136] : [148, 163, 184],
      size: "11px",
      outline: { color: [255, 255, 255], width: 1.5 }
    },
    attributes: st,
    popupTemplate: {
      title: `Trạm #${order}: ${st.stop_name}`,
      content: stopPopupHtml(st)
    }
  });
}

function createStopListItem(st, order) {
  const li = document.createElement("li");
  li.className = "stop-item";
  li.innerHTML = `
    <div class="stop-order">${order}</div>
    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <div style="font-weight: 600; color: #1e293b;">${st.stop_name}</div>
      <div style="font-size: 11px; color: #64748b;">${st.address || st.stop_id}</div>
    </div>
    <i class="fa-solid fa-chevron-right" style="color: #cbd5e1; font-size: 10px;"></i>
  `;
  li.onclick = () => focusStop(st, order);
  return li;
}

function focusStop(st, order) {
  if (!mapView) return;
  // Ở chế độ "Tất cả", giữ nguyên danh sách hiện tại khi bản đồ bay tới trạm
  if (currentSelectedRoute === "ALL") skipViewReloadUntil = Date.now() + 1500;
  mapView.goTo({ center: [st.longitude, st.latitude], zoom: 17 }, { duration: 600 });
  mapView.openPopup({
    title: `Trạm #${order}: ${st.stop_name}`,
    content: stopPopupHtml(st),
    location: { type: "point", longitude: st.longitude, latitude: st.latitude }
  });
}

function renderStopsList(stops, emptyMessage = "Không tìm thấy trạm phù hợp") {
  document.getElementById("stopsCount").innerText = `${stops.length} trạm`;
  const timeline = document.getElementById("stopsTimeline");
  timeline.innerHTML = "";
  if (stopsLayer) stopsLayer.removeAll();

  if (stops.length === 0) {
    timeline.innerHTML = `<li style="padding: 10px; color: #94a3b8; text-align: center;">${emptyMessage}</li>`;
    return;
  }

  stops.forEach((st, idx) => {
    const order = st.stop_order || (idx + 1);

    // Marker trên bản đồ
    if (GraphicClass && stopsLayer) {
      stopsLayer.add(createStopGraphic(st, order));
    }

    // Item trên Sidebar
    timeline.appendChild(createStopListItem(st, order));
  });
}
