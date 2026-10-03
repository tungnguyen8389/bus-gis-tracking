// --------------------------------------------------------------------
// ĐIỀU KHIỂN TRANG SỬA LỘ TRÌNH: TẢI TUYẾN, HOÀN TÁC, LƯU
// --------------------------------------------------------------------
let editorRoutes = [];
let editingRoute = null;     // { route_id, route_number, route_name, direction }
let savedSnapshot = null;    // Trạng thái đang có trong CSDL
let currentSnapshot = null;  // Trạng thái đang hiển thị
let undoStack = [];
let redoStack = [];
let isSaving = false;

// Các bước thao tác của SketchViewModel coi là một lần chỉnh sửa hoàn chỉnh
const SKETCH_EDIT_STEPS = ["move-stop", "reshape-stop", "vertex-add", "vertex-remove"];

async function initEditor() {
  document.getElementById("gap-threshold").innerText = GAP_THRESHOLD_M;
  document.getElementById("stop-threshold").innerText = STOP_FAR_THRESHOLD_M;
  updateEditorStatus();

  if (!(await checkEditorAuth())) return;

  editorRoutes = await apiGetJson("/routes");
  document.getElementById("select-route").innerHTML = routeOptionsHtml(editorRoutes);

  const params = new URLSearchParams(location.search);
  if (params.has("route_id")) document.getElementById("select-route").value = params.get("route_id");
  if (params.has("direction")) document.getElementById("select-direction").value = params.get("direction");

  initEditorMap(() => {
    sketchVM.on("update", onSketchUpdate);
    sketchVM.on("delete", onSketchDelete);
    if (params.has("route_id")) handleLoadClick();
  });
}

async function checkEditorAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
    if (res.ok) return true;
  } catch (e) {}
  document.getElementById("editor-auth-overlay").classList.add("active");
  return false;
}

function hasUnsavedChanges() {
  return !!currentSnapshot && !sameSnapshot(currentSnapshot, savedSnapshot);
}

// --------------------------------------------------------------------
// TẢI TUYẾN
// --------------------------------------------------------------------
async function handleLoadClick() {
  const routeSelect = document.getElementById("select-route");
  const directionSelect = document.getElementById("select-direction");

  if (hasUnsavedChanges() && !confirm("Có thay đổi chưa lưu. Bỏ qua và tải tuyến khác?")) {
    routeSelect.value = editingRoute.route_id;
    directionSelect.value = editingRoute.direction;
    return;
  }
  await loadRouteForEditing(routeSelect.value, Number(directionSelect.value));
}

async function loadRouteForEditing(routeId, direction) {
  const route = editorRoutes.find(r => r.route_id === routeId);
  if (!route) return;
  const info = document.getElementById("route-info");
  info.innerText = "Đang tải...";

  history.replaceState(null, "", `?route_id=${encodeURIComponent(routeId)}&direction=${direction}`);
  resetEditingState();

  try {
    const pathRes = await fetch(`${API_BASE}/routes/${encodeURIComponent(routeId)}/path?direction=${direction}`);
    if (pathRes.status === 404) {
      info.innerText = `Tuyến ${route.route_number} chưa có lộ trình cho chiều này.`;
      return;
    }
    if (!pathRes.ok) throw new Error(`HTTP ${pathRes.status}`);
    const pathGeoJson = await pathRes.json();
    const stops = await apiGetJson(`/routes/${encodeURIComponent(routeId)}/stops?direction=${direction}`);

    const coords = pathGeoJson.geometry.coordinates;
    renderEditableRoute(coords, Array.isArray(stops) ? stops : []);
    editingRoute = { ...route, direction };
    savedSnapshot = currentSnapshot = takeSnapshot();
    refreshAnalysis(savedSnapshot);
    info.innerText = `Tuyến ${route.route_number}: ${route.route_name} — ${coords.length} đỉnh, ${stopGraphics.length} trạm`;
  } catch (e) {
    info.innerText = "Lỗi tải lộ trình: " + e.message;
  }
  updateEditorStatus();
}

function resetEditingState() {
  clearEditableRoute();
  editingRoute = null;
  savedSnapshot = currentSnapshot = null;
  undoStack = [];
  redoStack = [];
  currentGaps = [];
  document.getElementById("gap-list").innerHTML = "";
  document.getElementById("stop-list").innerHTML = "";
  updateEditorStatus();
}

// --------------------------------------------------------------------
// GHI NHẬN CHỈNH SỬA & HOÀN TÁC
// --------------------------------------------------------------------
function onSketchUpdate(event) {
  const step = event.toolEventInfo && event.toolEventInfo.type;
  if (event.state === "complete" || SKETCH_EDIT_STEPS.includes(step)) recordIfChanged();
}

// SketchViewModel xoá cả graphic khi nhấn Delete mà chưa chọn đỉnh nào: đặt lại vào lớp
function onSketchDelete(event) {
  event.graphics.forEach(g => (g === pathGraphic ? editLayer.graphics.add(g, 0) : editLayer.add(g)));
  updateEditorStatus("Không xoá cả lộ trình / trạm. Muốn xoá đỉnh: chọn đỉnh rồi nhấn Delete.");
}

function recordIfChanged() {
  if (!editingRoute) return;
  const next = takeSnapshot();
  if (sameSnapshot(next, currentSnapshot)) return;
  undoStack.push(currentSnapshot);
  redoStack = [];
  currentSnapshot = next;
  refreshAnalysis(savedSnapshot);
  updateEditorStatus();
}

function restoreFrom(fromStack, toStack) {
  if (!editingRoute || fromStack.length === 0) return;
  // Kết thúc phiên kéo trước khi đổi currentSnapshot để sự kiện "complete" không bị ghi thành chỉnh sửa mới
  if (sketchVM.state === "active") sketchVM.complete();
  toStack.push(currentSnapshot);
  currentSnapshot = fromStack.pop();
  applySnapshot(currentSnapshot);
  refreshAnalysis(savedSnapshot);
  updateEditorStatus();
}

function undoEdit() { restoreFrom(undoStack, redoStack); }
function redoEdit() { restoreFrom(redoStack, undoStack); }

// Bắt phím ở pha capture để SketchViewModel không xử lý Ctrl+Z riêng cho phiên kéo hiện tại
window.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  const isUndo = key === "z" && !e.shiftKey;
  const isRedo = key === "y" || (key === "z" && e.shiftKey);
  if (!isUndo && !isRedo) return;
  e.preventDefault();
  e.stopPropagation();
  isUndo ? undoEdit() : redoEdit();
}, true);

window.addEventListener("beforeunload", e => {
  if (!hasUnsavedChanges()) return;
  e.preventDefault();
  e.returnValue = "";
});

function updateEditorStatus(note) {
  const status = document.getElementById("dirty-status");
  const dirty = hasUnsavedChanges();
  document.getElementById("btn-undo").disabled = undoStack.length === 0;
  document.getElementById("btn-redo").disabled = redoStack.length === 0;
  document.getElementById("btn-save").disabled = !dirty || isSaving;
  status.classList.toggle("dirty", dirty);

  if (note) {
    status.innerText = note;
  } else if (dirty) {
    const parts = [];
    if (pathChangedBetween(savedSnapshot, currentSnapshot)) parts.push("lộ trình");
    const movedStops = movedStopIndexes().length;
    if (movedStops) parts.push(`${movedStops} trạm`);
    status.innerText = `Chưa lưu: ${parts.join(", ")}`;
  } else {
    status.innerText = editingRoute ? "Không có thay đổi chưa lưu" : "";
  }
}

function movedStopIndexes() {
  return stopGraphics.map((_, i) => i).filter(i => stopMovedBetween(savedSnapshot, currentSnapshot, i));
}

// --------------------------------------------------------------------
// LƯU VÀO CSDL
// --------------------------------------------------------------------
async function saveEdits() {
  if (sketchVM.state === "active") sketchVM.complete();
  recordIfChanged();
  if (!editingRoute || !hasUnsavedChanges() || isSaving) return;

  isSaving = true;
  updateEditorStatus("Đang lưu...");
  const target = currentSnapshot;
  const saved = { path: savedSnapshot.path, stops: [...savedSnapshot.stops] };
  const errors = [];

  if (pathChangedBetween(savedSnapshot, target)) {
    const coordinates = target.path.map(viewToLonLat);
    const res = await apiRequest("POST", `/routes/${encodeURIComponent(editingRoute.route_id)}/path`, {
      direction: editingRoute.direction,
      coordinates
    });
    if (res.ok) saved.path = target.path;
    else errors.push("lộ trình: " + ((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`));
  }

  // Một trạm có thể xuất hiện 2 lần trên tuyến vòng: gửi mỗi stop_id một lần
  const sentStopIds = new Set();
  for (const i of movedStopIndexes()) {
    const a = stopGraphics[i].attributes;
    if (sentStopIds.has(a.stop_id)) continue;
    sentStopIds.add(a.stop_id);
    const [longitude, latitude] = viewToLonLat(target.stops[i]);
    // API ghi đè cả tên & địa chỉ nên phải gửi lại giá trị hiện có
    const res = await apiRequest("PUT", `/stops/${encodeURIComponent(a.stop_id)}`, {
      stop_name: a.stop_name,
      address: a.address,
      longitude,
      latitude
    });
    if (res.ok) {
      stopGraphics.forEach((g, j) => { if (g.attributes.stop_id === a.stop_id) saved.stops[j] = target.stops[j]; });
    } else {
      errors.push(`trạm ${a.stop_name}: HTTP ${res.status}`);
    }
  }

  savedSnapshot = saved;
  isSaving = false;
  refreshAnalysis(savedSnapshot);
  updateEditorStatus(errors.length ? "Lỗi lưu " + errors.join("; ") : "Đã lưu ✓");
}

initEditor();
