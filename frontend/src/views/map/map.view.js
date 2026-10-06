// Entry trang bản đồ công khai (index.html)
import { mountSections } from "../../core/dom.js";
import { registerActions } from "../../core/actions.js";
import { createBaseMap, toggleLayer } from "./features/base-map.js";
import { onRouteChanged, setDirection, filterStops } from "./features/route-browser.js";
import { renderDestSuggestions } from "./features/trip-finder/trip-finder.js";
import {
  initSidebarForRole, openLoginModal, closeLoginModal, bindLoginModalKeys, handleStaffLogin, logoutStaff
} from "./features/staff-auth.js";

registerActions({
  // staff-auth
  openLoginModal: () => openLoginModal(),
  closeLoginModal: () => closeLoginModal(),
  loginBackdrop: (el, e) => { if (e.target === el) closeLoginModal(); },
  handleStaffLogin: (el, e) => handleStaffLogin(e),
  logoutStaff: () => logoutStaff(),
  // route-browser
  onRouteChanged: () => onRouteChanged(),
  setDirection: el => setDirection(Number(el.dataset.arg)),
  filterStops: () => filterStops(),
  toggleLayer: el => toggleLayer(el.dataset.arg, el.checked),
  // trip-finder
  renderDestSuggestions: () => renderDestSuggestions()
});

await mountSections(import.meta.url);
bindLoginModalKeys();

// Chọn sidebar theo vai trò, nạp dữ liệu bản đồ & kết nối realtime theo vai trò (không yêu cầu đăng nhập)
await createBaseMap();
initSidebarForRole();
