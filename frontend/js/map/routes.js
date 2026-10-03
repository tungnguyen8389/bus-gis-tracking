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
        mapView.goTo(coords, { duration: 800 });
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

async function loadAllRoutesAndStops() {
  if (!clearRouteAndStopLayers()) return;

  try {
    const res = await fetch(`${API_BASE}/stops`);
    const data = await res.json();
    const features = data.features || [];
    currentRawStops = features.map((f, i) => ({
      stop_id: f.properties.stop_id,
      stop_name: f.properties.stop_name,
      address: f.properties.address,
      stop_order: i + 1,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1]
    }));
    renderStopsList(currentRawStops);
  } catch (e) {}
}

// --------------------------------------------------------------------
// TÌM KIẾM TRẠM DỪNG & RENDER DANH SÁCH
// --------------------------------------------------------------------
function filterStops() {
  const keyword = document.getElementById("stopSearchInput").value.toLowerCase().trim();
  if (!keyword) {
    renderStopsList(currentRawStops);
    return;
  }
  const matches = value => value && value.toLowerCase().includes(keyword);
  const filtered = currentRawStops.filter(s => matches(s.stop_name) || matches(s.address) || matches(s.stop_id));
  renderStopsList(filtered);
}

function createStopGraphic(st, order) {
  return new GraphicClass({
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
  mapView.goTo({ center: [st.longitude, st.latitude], zoom: 17 }, { duration: 600 });
  mapView.openPopup({
    title: `Trạm #${order}: ${st.stop_name}`,
    content: `<b>Mã trạm:</b> ${st.stop_id}<br><b>Địa chỉ:</b> ${st.address || "---"}`,
    location: { type: "point", longitude: st.longitude, latitude: st.latitude }
  });
}

function renderStopsList(stops) {
  document.getElementById("stopsCount").innerText = `${stops.length} trạm`;
  const timeline = document.getElementById("stopsTimeline");
  timeline.innerHTML = "";
  if (stopsLayer) stopsLayer.removeAll();

  if (stops.length === 0) {
    timeline.innerHTML = `<li style="padding: 10px; color: #94a3b8; text-align: center;">Không tìm thấy trạm phù hợp</li>`;
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
