// --------------------------------------------------------------------
// QUẢN LÝ XÁC THỰC (AUTHENTICATION & ROLES)
// --------------------------------------------------------------------
let currentUser = null;

const ROLE_LABELS = {
  ADMIN: "Quản trị viên (ADMIN)",
  MANAGER: "Quản lý tuyến (MANAGER)",
  VIEWER: "Khách (VIEWER)"
};

function getStoredToken() {
  // Chỉ sử dụng token người dùng frontend (bus_user_token), không tự động kế thừa bus_admin_token
  return localStorage.getItem(USER_TOKEN_KEY);
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  const alertBox = document.getElementById("authAlert");

  alertBox.className = "auth-alert";
  alertBox.style.display = "none";

  document.getElementById("tabBtnLogin").classList.toggle("active", isLogin);
  document.getElementById("tabBtnRegister").classList.toggle("active", !isLogin);
  document.getElementById("loginForm").style.display = isLogin ? "block" : "none";
  document.getElementById("registerForm").style.display = isLogin ? "none" : "block";
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const willShow = input.type === "password";
  input.type = willShow ? "text" : "password";
  btn.innerHTML = `<i class="fa-solid ${willShow ? "fa-eye-slash" : "fa-eye"}"></i>`;
}

function showAuthAlert(message, type = "error") {
  const alertBox = document.getElementById("authAlert");
  alertBox.className = `auth-alert ${type}`;
  alertBox.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i> ${message}`;
  alertBox.style.display = "block";
}

// Bật/tắt trạng thái "đang xử lý" cho nút submit
function setButtonBusy(btn, isBusy, busyHtml, idleHtml) {
  btn.disabled = isBusy;
  btn.innerHTML = isBusy ? busyHtml : idleHtml;
}

async function checkAuthOnStartup() {
  const token = getStoredToken();
  if (!token) {
    openAuthModal();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.ok) {
      currentUser = await res.json();
      onLoginSuccess(token, currentUser, false);
    } else {
      localStorage.removeItem(USER_TOKEN_KEY);
      openAuthModal();
    }
  } catch (err) {
    console.warn("Không kết nối được server kiểm tra auth:", err);
    openAuthModal();
  }
}

function setAuthModalVisible(isVisible) {
  document.getElementById("authModalOverlay").classList.toggle("hidden", !isVisible);
  document.getElementById("viewDiv").classList.toggle("blurred", isVisible);
  document.getElementById("userProfileBar").style.display = isVisible ? "none" : "flex";
}

function openAuthModal() {
  setAuthModalVisible(true);
}

function closeAuthModal() {
  setAuthModalVisible(false);
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("btnLoginSubmit");

  if (!username || !password) {
    showAuthAlert("Vui lòng nhập tên đăng nhập và mật khẩu!", "error");
    return;
  }

  try {
    setButtonBusy(btn, true, `<i class="fa-solid fa-spinner fa-spin"></i> Đang xác thực...`);

    const res = await postJson("/auth/login", { username, password });
    const data = await res.json();
    if (res.ok) {
      showAuthAlert("Đăng nhập thành công!", "success");
      setTimeout(() => {
        onLoginSuccess(data.token, data.user, true);
      }, 400);
    } else {
      showAuthAlert(data.error || "Tên đăng nhập hoặc mật khẩu không chính xác", "error");
    }
  } catch (err) {
    showAuthAlert("Không thể kết nối đến máy chủ Backend (Port 3000)", "error");
  } finally {
    setButtonBusy(btn, false, null, `<i class="fa-solid fa-arrow-right-to-bracket"></i> ĐĂNG NHẬP VÀO BẢN ĐỒ`);
  }
}

function quickLogin(user, pwd) {
  document.getElementById("loginUsername").value = user;
  document.getElementById("loginPassword").value = pwd;
  handleLoginSubmit(new Event("submit"));
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const full_name = document.getElementById("regFullName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;
  const btn = document.getElementById("btnRegisterSubmit");

  if (password !== confirmPassword) {
    showAuthAlert("Mật khẩu xác nhận không khớp!", "error");
    return;
  }
  if (password.length < 6) {
    showAuthAlert("Mật khẩu phải có độ dài từ 6 ký tự trở lên!", "error");
    return;
  }

  try {
    setButtonBusy(btn, true, `<i class="fa-solid fa-spinner fa-spin"></i> Đang khởi tạo tài khoản...`);

    const res = await postJson("/auth/register", { username, password, full_name, email, role: "VIEWER" });
    const data = await res.json();
    if (res.ok) {
      showAuthAlert("Đăng ký tài khoản Khách thành công! Đang tự động đăng nhập...", "success");
      showToast(`Chào mừng ${full_name} đến với hệ thống!`, "success");

      // Tự động đăng nhập
      setTimeout(() => {
        quickLogin(username, password);
      }, 700);
    } else {
      showAuthAlert(data.error || "Đăng ký thất bại. Tên đăng nhập có thể đã tồn tại.", "error");
    }
  } catch (err) {
    showAuthAlert("Lỗi kết nối máy chủ", "error");
  } finally {
    setButtonBusy(btn, false, null, `<i class="fa-solid fa-user-check"></i> ĐĂNG KÝ & TRUY CẬP NGAY`);
  }
}

// Cập nhật Header Profile Bar theo người dùng đang đăng nhập
function renderUserProfile(user) {
  const avatarEl = document.getElementById("topUserAvatar");
  avatarEl.innerText = (user.full_name || user.username || "K").charAt(0).toUpperCase();
  avatarEl.className = `user-avatar role-${user.role}`;

  document.getElementById("topUserName").innerText = user.full_name || user.username;

  const roleBadge = document.getElementById("topUserRole");
  roleBadge.innerText = ROLE_LABELS[user.role] || ROLE_LABELS.VIEWER;
  roleBadge.className = `user-role-badge badge-role-${user.role}`;

  // Nút Admin Portal chỉ hiện với ADMIN / MANAGER
  const canAccessAdmin = user.role === "ADMIN" || user.role === "MANAGER";
  const btnAdmin = document.getElementById("btnTopAdminPortal");
  const btnBottomAdmin = document.getElementById("btnBottomAdminLink");
  if (btnAdmin) btnAdmin.style.display = canAccessAdmin ? "flex" : "none";
  if (btnBottomAdmin) btnBottomAdmin.style.display = canAccessAdmin ? "block" : "none";
}

function onLoginSuccess(token, user, showWelcomeToast = true) {
  currentUser = user;
  localStorage.setItem(USER_TOKEN_KEY, token);

  renderUserProfile(user);
  closeAuthModal();

  if (showWelcomeToast) {
    const roleLabel = ROLE_LABELS[user.role] || ROLE_LABELS.VIEWER;
    showToast(`🎉 Xin chào ${user.full_name}! Quyền truy cập: ${roleLabel}`, "success");
  }

  // Nạp dữ liệu bản đồ
  if (allRoutes.length === 0) {
    loadRoutesList();
  }
  if (!socketInstance) {
    initSocketRealtime();
  }
}

function logoutUser() {
  localStorage.removeItem(USER_TOKEN_KEY);
  currentUser = null;
  openAuthModal();
  showToast("👋 Bạn đã đăng xuất thành công.", "info");
}
