import { state } from "../map.state.js";
import { showToast } from "../../../core/toast.js";

// --------------------------------------------------------------------
// THÔNG BÁO LỖI ĐỊNH VỊ (GeolocationPositionError: 1 từ chối, 2 không xác định, 3 hết giờ)
// --------------------------------------------------------------------
export function geolocationErrorMessage(err) {
  const code = err?.code ?? err?.details?.code ?? err?.details?.error?.code;
  if (code === 1) return "Bạn đã từ chối quyền truy cập vị trí. Hãy cho phép trong cài đặt trình duyệt.";
  if (code === 2) return "Không xác định được vị trí hiện tại. Kiểm tra GPS / kết nối mạng.";
  if (code === 3) return "Hết thời gian chờ định vị. Vui lòng thử lại.";
  return "Không thể định vị vị trí của bạn.";
}

// Lấy vị trí hiện tại (dùng lại kết quả trong 60 giây); trả null nếu khách từ chối / lỗi
export function getUserPosition() {
  if (state.userPosition && Date.now() - state.userPosition.time < 60000) return Promise.resolve(state.userPosition);
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userPosition = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, time: Date.now() };
        resolve(state.userPosition);
      },
      err => {
        console.warn("Không lấy được vị trí:", err);
        showToast(geolocationErrorMessage(err), "warning");
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}
