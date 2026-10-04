// Entry trang tài xế (driver.html): Đăng nhập → Chọn chuyến → Chạy xe
import { mountSections } from "../../core/dom.js";
import { registerActions } from "../../core/actions.js";
import { showScreen } from "./features/screens.js";
import { restoreSession, handleLogin, logout } from "./features/driver-auth.js";
import { renderTrips, selectTrip } from "./features/trip-select.js";
import { openDrive, closeDrive, toggleFollow } from "./features/drive-map.js";
import { toggleTrip, stopBroadcast } from "./features/phone-gps.js";

function enterTrips() {
  renderTrips();
  showScreen("screenTrips");
}

// Rời màn Chạy xe: kết thúc chuyến đang phát (nếu có) và ngắt feed viewer
async function leaveDrive() {
  await stopBroadcast();
  closeDrive();
}

registerActions({
  driverLogin: async (el, e) => {
    e.preventDefault();
    if (await handleLogin()) enterTrips();
  },
  driverLogout: async () => {
    await leaveDrive();
    logout();
    showScreen("screenLogin");
  },
  selectTrip: async el => {
    if (!selectTrip(Number(el.dataset.arg))) return;
    showScreen("screenDrive");
    await openDrive();
  },
  changeTrip: async () => {
    await leaveDrive();
    enterTrips();
  },
  toggleTrip: () => toggleTrip(),
  toggleFollow: () => toggleFollow()
});

await mountSections(import.meta.url);
if (await restoreSession()) enterTrips();
else showScreen("screenLogin");
