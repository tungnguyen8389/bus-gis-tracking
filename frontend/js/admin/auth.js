// --------------------------------------------------------------------
// XÁC THỰC QUẢN TRỊ (Auth Check & Token Handling)
// --------------------------------------------------------------------
let currentUser = null;

function setAuthScreenVisible(isVisible) {
  document.getElementById("auth-screen").style.display = isVisible ? "flex" : "none";
}

async function checkAuth() {
  // Không có token vẫn gọi /auth/me: backend chạy DISABLE_AUTH=true sẽ trả về user mặc định
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
    if (res.ok) {
      currentUser = await res.json();
      setAuthScreenVisible(false);
      document.getElementById("user-display-name").innerText = currentUser.full_name;
      document.getElementById("user-display-role").innerText = currentUser.role;

      if (currentUser.role !== "ADMIN") {
        const navUsers = document.getElementById("nav-users");
        if (navUsers) navUsers.style.display = "none";
      }
      loadDashboardStats();
      loadRoutes();
    } else {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAuthScreenVisible(true);
    }
  } catch (err) {
    setAuthScreenVisible(true);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login_username").value;
  const password = document.getElementById("login_password").value;
  const alertBox = document.getElementById("login-alert");

  const showLoginError = message => {
    alertBox.innerText = message;
    alertBox.style.display = "block";
  };

  try {
    const res = await postJson("/auth/login", { username, password });
    const data = await res.json();

    if (res.ok) {
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      alertBox.style.display = "none";
      checkAuth();
    } else {
      showLoginError(data.error || "Đăng nhập thất bại");
    }
  } catch (err) {
    showLoginError("Không thể kết nối đến máy chủ: " + err.message);
  }
}

function handleLogout() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  location.reload();
}
