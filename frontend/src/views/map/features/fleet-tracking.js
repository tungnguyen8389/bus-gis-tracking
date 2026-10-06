import { state, map } from "../map.state.js";
import { connectRealtime } from "../../../modules/realtime/realtime.service.js";

// --------------------------------------------------------------------
// WEBSOCKET GPS REALTIME & TÍNH TOÁN TRẠM TIẾP THEO
// --------------------------------------------------------------------
let socketInstance = null;
// Hook cho các feature khác (trip-watch của khách) mà không import vòng
const fleetListeners = { connect: [], offline: [], tripsUpdate: [] };
export function onFleetEvent(name, fn) {
  fleetListeners[name].push(fn);
}
const emitFleetEvent = (name, data) => fleetListeners[name].forEach(fn => fn(data));
export const getFleetSocket = () => socketInstance;

// --------------------------------------------------------------------
// BỘ ĐIỀU KHIỂN HOẠT HỌA XE BUÝT 60 FPS SIÊU MƯỢT (NATIVE WEB MERCATOR)
// --------------------------------------------------------------------
const busAnimStates = {};
const busCurrentPositions = {};
let isAnimatingFleet = false;

// Cập nhật hiển thị xe buýt tức thì phù hợp với tuyến đang chọn
export function applyFleetFilter() {
  Object.keys(state.busGraphics).forEach(vehId => {
    const g = state.busGraphics[vehId];
    if (g && g.attributes) {
      g.visible = (state.currentSelectedRoute === "ALL" || g.attributes.route_id === state.currentSelectedRoute);
    }
  });
}

// Gỡ mọi xe khỏi bản đồ (đổi vai trò, khách đổi chuyến theo dõi)
export function clearFleet() {
  if (map.fleetLayer) map.fleetLayer.removeAll();
  Object.keys(state.busGraphics).forEach(id => delete state.busGraphics[id]);
  Object.keys(busAnimStates).forEach(id => delete busAnimStates[id]);
  Object.keys(busCurrentPositions).forEach(id => delete busCurrentPositions[id]);
  state.selectedTrackedVehicleId = null;
}

// Hàm chuyển đổi siêu tốc WGS84 -> Web Mercator (WKID 3857) để render trực tiếp trên WebGL không qua tầng reprojection
function toWebMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}

function animateFleetMovement() {
  const now = performance.now();
  let hasActiveAnim = false;
  const mapView = map.view;

  Object.keys(busAnimStates).forEach(vehId => {
    const anim = busAnimStates[vehId];
    const g = state.busGraphics[vehId];
    if (!anim || !g) return;

    if (anim.completed) return;

    const elapsed = now - anim.startTime;
    const progress = Math.min(1.0, elapsed / anim.duration);

    let curLon, curLat;

    if (progress < 1.0) {
      hasActiveAnim = true;
      // Nội suy tuyến tính mượt từng frame
      curLon = anim.startLon + (anim.targetLon - anim.startLon) * progress;
      curLat = anim.startLat + (anim.targetLat - anim.startLat) * progress;
    } else {
      anim.completed = true;
      curLon = anim.targetLon;
      curLat = anim.targetLat;
    }

    // Lưu vị trí hiện thời
    anim.curLon = curLon;
    anim.curLat = curLat;
    busCurrentPositions[vehId] = { lon: curLon, lat: curLat };

    // Render trực tiếp trên không gian tọa độ gốc của MapView (Web Mercator)
    const [mx, my] = toWebMercator(curLon, curLat);
    if (map.Point) {
      g.geometry = new map.Point({
        x: mx,
        y: my,
        spatialReference: { wkid: 3857 }
      });
    } else {
      g.geometry = {
        type: "point",
        x: mx,
        y: my,
        spatialReference: { wkid: 3857 }
      };
    }

    // Tự động di chuyển Popup theo xe (tạm dừng khi người dùng đang zoom/pan để tránh giật camera)
    if (mapView && mapView.popup && mapView.popup.visible && mapView.popup.selectedFeature) {
      const sf = mapView.popup.selectedFeature;
      if (sf === g || (sf.attributes && sf.attributes.vehicle_id === vehId)) {
        if (!mapView.interacting && !mapView.navigating) {
          mapView.popup.location = g.geometry;
        }
      }
    }
  });

  if (hasActiveAnim) {
    requestAnimationFrame(animateFleetMovement);
  } else {
    isAnimatingFleet = false;
  }
}

function setConnectionStatus(text, className) {
  const statusEl = document.getElementById("busStatus");
  if (statusEl) {
    statusEl.innerText = text;
    statusEl.className = className;
  }
}

// Cập nhật thông số Bảng điều khiển nổi bên phải cho xe đang được chọn theo dõi
function renderTrackedVehicle(data, rName) {
  const busRouteEl = document.getElementById("busRouteName");
  if (busRouteEl) busRouteEl.innerText = rName;
  const busPlateEl = document.getElementById("busPlate");
  if (busPlateEl) busPlateEl.innerText = data.plate_number || data.vehicle_id;
  const busSpeedEl = document.getElementById("busSpeed");
  if (busSpeedEl) busSpeedEl.innerText = data.speed_kmh || 0;
  const busCoordEl = document.getElementById("busCoord");
  if (busCoordEl) busCoordEl.innerText = `[${data.longitude.toFixed(4)}, ${data.latitude.toFixed(4)}]`;

  // Tính toán trạm tiếp theo sắp tới CHUẨN XÁC cho xe đang theo dõi này
  if (state.currentRawStops.length > 0) {
    let nextStop = state.currentRawStops[0].stop_name;
    let minDistance = Infinity;
    state.currentRawStops.forEach(st => {
      const dist = Math.hypot(st.longitude - data.longitude, st.latitude - data.latitude);
      if (dist < minDistance) {
        minDistance = dist;
        nextStop = st.stop_name;
      }
    });
    const nextStopEl = document.getElementById("nextStopName");
    if (nextStopEl) nextStopEl.innerText = nextStop;
  }
}

function onFleetLocationUpdate(data) {
  if (!data || !data.vehicle_id || !map.fleetLayer) return;
  // Khách chỉ hiện đúng chuyến đang theo dõi (server đã lọc theo room; chặn thêm ở client)
  if (!state.isStaff && data.schedule_id !== state.watchedScheduleId) return;
  const busGraphics = state.busGraphics;
  const mapView = map.view;

  // Lọc theo tuyến nếu đang chọn 1 tuyến cụ thể
  const isMatchRoute = (state.currentSelectedRoute === "ALL" || data.route_id === state.currentSelectedRoute);
  if (!isMatchRoute) {
    if (busGraphics[data.vehicle_id]) {
      busGraphics[data.vehicle_id].visible = false;
    }
    return;
  }

  // Tên tuyến và thông tin tuyến dùng chung
  const rObj = state.allRoutes.find(r => r.route_id === data.route_id);
  const rName = rObj ? `Tuyến ${rObj.route_number}` : (data.route_id || "Tuyến xe");

  // Nếu chưa có xe theo dõi hoặc xe cũ không còn thuộc tuyến, tự động gán xe đầu tiên
  if (!state.selectedTrackedVehicleId || (busGraphics[state.selectedTrackedVehicleId] && !busGraphics[state.selectedTrackedVehicleId].visible)) {
    state.selectedTrackedVehicleId = data.vehicle_id;
  }

  // Cập nhật thông số Bảng điều khiển nổi bên phải CHỈ CHO XE ĐANG ĐƯỢC CHỌN THEO DÕI
  if (data.vehicle_id === state.selectedTrackedVehicleId) {
    renderTrackedVehicle(data, rName);
  }

  if (busGraphics[data.vehicle_id]) {
    const g = busGraphics[data.vehicle_id];
    g.visible = true;

    // Lấy chính xác vị trí đang đứng từ cache busCurrentPositions
    const prevPos = busCurrentPositions[data.vehicle_id] || { lon: data.longitude, lat: data.latitude };
    const startLon = prevPos.lon;
    const startLat = prevPos.lat;

    // Kiểm tra khoảng cách nhảy (nếu xe loop về đầu tuyến > 0.005 độ ~ 500m thì snap)
    const jumpDistance = Math.hypot(data.longitude - startLon, data.latitude - startLat);
    const isTeleport = jumpDistance > 0.005;

    busAnimStates[data.vehicle_id] = {
      startLon: isTeleport ? data.longitude : startLon,
      startLat: isTeleport ? data.latitude : startLat,
      curLon: isTeleport ? data.longitude : startLon,
      curLat: isTeleport ? data.latitude : startLat,
      targetLon: data.longitude,
      targetLat: data.latitude,
      startTime: performance.now(),
      duration: 500, // 500ms khớp chu kỳ phát của Simulator
      completed: isTeleport
    };

    if (isTeleport) {
      busCurrentPositions[data.vehicle_id] = { lon: data.longitude, lat: data.latitude };
      const [mx, my] = toWebMercator(data.longitude, data.latitude);
      if (map.Point) {
        g.geometry = new map.Point({ x: mx, y: my, spatialReference: { wkid: 3857 } });
      }
    }

    g.attributes.speed = data.speed_kmh;
    g.attributes.heading = data.heading || 0;
    g.attributes.route_id = data.route_id;
    g.attributes.route = rName;

    // Làm mới nội dung thông số bên trong Popup nếu đang mở xem xe này
    if (mapView && mapView.popup && mapView.popup.visible && mapView.popup.selectedFeature) {
      const sf = mapView.popup.selectedFeature;
      if (sf === g || (sf.attributes && sf.attributes.vehicle_id === data.vehicle_id)) {
        sf.attributes.speed = data.speed_kmh;
        sf.attributes.heading = data.heading || 0;
        if (mapView.popup.viewModel && mapView.popup.viewModel.refresh) {
          mapView.popup.viewModel.refresh();
        }
      }
    }

    if (!isAnimatingFleet && !isTeleport) {
      isAnimatingFleet = true;
      requestAnimationFrame(animateFleetMovement);
    }
  } else {
    const [mx, my] = toWebMercator(data.longitude, data.latitude);
    const busGraphic = new map.Graphic({
      geometry: { type: "point", x: mx, y: my, spatialReference: { wkid: 3857 } },
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
        route: rName,
        speed: data.speed_kmh || 0,
        heading: data.heading || 0
      },
      popupTemplate: {
        title: "🚌 Xe Buýt: {plate}",
        content: "<b>Tuyến:</b> {route}<br><b>Vận tốc:</b> {speed} km/h<br><b>Hướng di chuyển:</b> {heading}°<br><b>Trạng thái:</b> Đang vận hành"
      }
    });

    map.fleetLayer.add(busGraphic);
    busGraphics[data.vehicle_id] = busGraphic;
    busCurrentPositions[data.vehicle_id] = { lon: data.longitude, lat: data.latitude };

    busAnimStates[data.vehicle_id] = {
      startLon: data.longitude,
      startLat: data.latitude,
      curLon: data.longitude,
      curLat: data.latitude,
      targetLon: data.longitude,
      targetLat: data.latitude,
      startTime: performance.now(),
      duration: 500,
      completed: true
    };
  }
}

// Xe kết thúc chuyến hoặc thiết bị mất kết nối → gỡ khỏi bản đồ và xóa cache hoạt họa
function onVehicleOffline({ vehicle_id, schedule_id } = {}) {
  const g = state.busGraphics[vehicle_id];
  if (g && map.fleetLayer) map.fleetLayer.remove(g);
  delete state.busGraphics[vehicle_id];
  delete busAnimStates[vehicle_id];
  delete busCurrentPositions[vehicle_id];
  if (state.selectedTrackedVehicleId === vehicle_id) state.selectedTrackedVehicleId = null;
  emitFleetEvent("offline", { vehicle_id, schedule_id });
}

// Kết nối (lại) theo vai trò: nhân viên gửi token để vào room staff, khách kết nối không token.
// Mỗi lần đổi vai trò dùng socket mới → không còn giữ room của vai trò cũ.
export function connectFleetSocket(token) {
  if (socketInstance) socketInstance.disconnect();
  clearFleet();
  try {
    socketInstance = connectRealtime({
      token,
      onConnect: () => {
        setConnectionStatus("ONLINE", "badge-status");
        emitFleetEvent("connect");
      },
      onDisconnect: () => setConnectionStatus("OFFLINE", "badge-status badge-disconnected"),
      onFleetUpdate: onFleetLocationUpdate,
      onVehicleOffline,
      onTripsUpdate: data => emitFleetEvent("tripsUpdate", data)
    });
  } catch (err) {
    console.warn("Lỗi kết nối Socket:", err);
    socketInstance = null;
  }
  return socketInstance;
}
