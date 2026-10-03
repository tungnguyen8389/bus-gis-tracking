// --------------------------------------------------------------------
// TIỆN ÍCH GỌI API & RENDER DÙNG CHUNG
// --------------------------------------------------------------------

// Gửi POST JSON không cần token (đăng nhập, đăng ký)
function postJson(path, body) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// Danh sách <option> cho dropdown chọn tuyến
function routeOptionsHtml(routes) {
  return routes
    .map(r => `<option value="${r.route_id}">Tuyến ${r.route_number}: ${r.route_name}</option>`)
    .join("");
}
