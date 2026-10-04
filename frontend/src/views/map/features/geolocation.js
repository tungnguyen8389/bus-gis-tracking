import { state } from "../map.state.js";
import { showToast } from "../../../core/toast.js";
import { geolocationErrorMessage } from "../../../core/geo-error.js";
export { geolocationErrorMessage };

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
