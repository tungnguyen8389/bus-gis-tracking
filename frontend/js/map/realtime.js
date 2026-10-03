// --------------------------------------------------------------------
// WEBSOCKET GPS REALTIME & TÍNH TOÁN TRẠM TIẾP THEO
// --------------------------------------------------------------------
let socketInstance = null;
const busGraphics = {};

// Chu kỳ phát GPS của Simulator (ms) — dùng làm thời lượng nội suy
const BUS_ANIM_DURATION_MS = 1000;

function setConnectionStatus(isOnline) {
  const statusEl = document.getElementById("busStatus");
  if (!statusEl) return;
  statusEl.innerText = isOnline ? "ONLINE" : "OFFLINE";
  statusEl.className = isOnline ? "badge-status" : "badge-status badge-disconnected";
}

function initSocketRealtime() {
  try {
    if (socketInstance) return;
    socketInstance = io(SERVER_URL, { reconnection: true, timeout: 5000 });

    socketInstance.on("connect", () => setConnectionStatus(true));
    socketInstance.on("disconnect", () => setConnectionStatus(false));
    socketInstance.on("fleet_location_update", onFleetLocationUpdate);
  } catch (err) {
    console.warn("Lỗi kết nối Socket:", err);
  }
}

// --------------------------------------------------------------------
// BỘ ĐIỀU KHIỂN HOẠT HỌA 60 FPS (SMOOTH INTERPOLATION ANIMATION)
// --------------------------------------------------------------------
const busAnimStates = {};
let isAnimatingFleet = false;

// Popup của bản đồ có đang mở cho xe này không
function isPopupShowingVehicle(graphic, vehId) {
  if (!mapView || !mapView.popup || !mapView.popup.visible || !mapView.popup.selectedFeature) return false;
  const selected = mapView.popup.selectedFeature;
  return selected === graphic || (selected.attributes && selected.attributes.vehicle_id === vehId);
}

function animateFleetMovement() {
  const now = performance.now();
  let hasActiveAnim = false;

  Object.keys(busAnimStates).forEach(vehId => {
    const anim = busAnimStates[vehId];
    const g = busGraphics[vehId];
    if (!anim || !g) return;

    const elapsed = now - anim.startTime;
    const progress = Math.min(1.0, elapsed / anim.duration);

    if (progress < 1.0) {
      hasActiveAnim = true;
    }

    // Nội suy tuyến tính mượt mà giữa điểm cũ và điểm mới
    const curLon = anim.startLon + (anim.targetLon - anim.startLon) * progress;
    const curLat = anim.startLat + (anim.targetLat - anim.startLat) * progress;

    if (PointClass) {
      g.geometry = new PointClass({ longitude: curLon, latitude: curLat });
    } else {
      g.geometry = { type: "point", longitude: curLon, latitude: curLat };
    }

    // Tự động di chuyển cửa sổ Popup theo sát xe buýt khi xe đang lăn bánh
    if (isPopupShowingVehicle(g, vehId)) {
      mapView.popup.location = g.geometry;
    }
  });

  if (hasActiveAnim || Object.keys(busAnimStates).length > 0) {
    requestAnimationFrame(animateFleetMovement);
  } else {
    isAnimatingFleet = false;
  }
}

// Bắt đầu nội suy vị trí xe từ (startLon, startLat) tới tọa độ mới
function startBusAnimation(vehId, startLon, startLat, targetLon, targetLat) {
  busAnimStates[vehId] = {
    startLon,
    startLat,
    targetLon,
    targetLat,
    startTime: performance.now(),
    duration: BUS_ANIM_DURATION_MS
  };

  if (!isAnimatingFleet) {
    isAnimatingFleet = true;
    requestAnimationFrame(animateFleetMovement);
  }
}

// Cập nhật thông số Bảng điều khiển nổi bên phải
function renderFleetPanel(data, routeName) {
  document.getElementById("busRouteName").innerText = routeName;
  document.getElementById("busPlate").innerText = data.plate_number || data.vehicle_id;
  document.getElementById("busSpeed").innerText = data.speed_kmh || 0;
  document.getElementById("busCoord").innerText = `[${data.longitude.toFixed(4)}, ${data.latitude.toFixed(4)}]`;
}

// Tính toán trạm tiếp theo sắp tới (Trạm gần nhất phía trước)
function renderNextStop(data) {
  if (currentRawStops.length === 0) return;

  let nextStop = currentRawStops[0].stop_name;
  let minDistance = Infinity;
  currentRawStops.forEach(st => {
    const dist = Math.hypot(st.longitude - data.longitude, st.latitude - data.latitude);
    if (dist < minDistance) {
      minDistance = dist;
      nextStop = st.stop_name;
    }
  });
  document.getElementById("nextStopName").innerText = nextStop;
}

function createBusGraphic(data, routeName) {
  return new GraphicClass({
    geometry: { type: "point", longitude: data.longitude, latitude: data.latitude },
    symbol: {
      type: "simple-marker",
      color: [255, 59, 48], // Đỏ nổi bật
      size: "14px",
      outline: { color: [255, 255, 255], width: 2 }
    },
    attributes: {
      vehicle_id: data.vehicle_id,
      plate: data.plate_number || data.vehicle_id,
      route_id: data.route_id,
      route: routeName,
      speed: data.speed_kmh || 0,
      heading: data.heading || 0
    },
    popupTemplate: {
      title: "🚌 Xe Buýt: {plate}",
      content: "<b>Tuyến:</b> {route}<br><b>Vận tốc:</b> {speed} km/h<br><b>Hướng di chuyển:</b> {heading}°<br><b>Trạng thái:</b> Đang vận hành"
    }
  });
}

function updateExistingBus(g, data, routeName) {
  g.visible = true;

  // Điểm bắt đầu nội suy là vị trí hiện thời của Graphic trên bản đồ
  const startLon = g.geometry ? g.geometry.longitude : data.longitude;
  const startLat = g.geometry ? g.geometry.latitude : data.latitude;

  g.attributes.speed = data.speed_kmh;
  g.attributes.heading = data.heading || 0;
  g.attributes.route_id = data.route_id;
  g.attributes.route = routeName;

  // Làm mới nội dung thông số bên trong Popup nếu đang mở xem xe này
  if (isPopupShowingVehicle(g, data.vehicle_id)) {
    const sf = mapView.popup.selectedFeature;
    sf.attributes.speed = data.speed_kmh;
    sf.attributes.heading = data.heading || 0;
    if (mapView.popup.viewModel && mapView.popup.viewModel.refresh) {
      mapView.popup.viewModel.refresh();
    }
  }

  startBusAnimation(data.vehicle_id, startLon, startLat, data.longitude, data.latitude);
}

function onFleetLocationUpdate(data) {
  if (!data || !data.vehicle_id || !fleetLayer) return;

  // Lọc theo tuyến nếu đang chọn 1 tuyến cụ thể
  if (!isRouteSelected(data.route_id)) {
    if (busGraphics[data.vehicle_id]) {
      busGraphics[data.vehicle_id].visible = false;
    }
    return;
  }

  const rObj = allRoutes.find(r => r.route_id === data.route_id);
  const routeName = rObj ? `Tuyến ${rObj.route_number}` : (data.route_id || "Tuyến xe");
  renderFleetPanel(data, routeName);
  renderNextStop(data);

  const existing = busGraphics[data.vehicle_id];
  if (existing) {
    updateExistingBus(existing, data, routeName);
  } else {
    const busGraphic = createBusGraphic(data, routeName);
    fleetLayer.add(busGraphic);
    busGraphics[data.vehicle_id] = busGraphic;
    startBusAnimation(data.vehicle_id, data.longitude, data.latitude, data.longitude, data.latitude);
  }
}
