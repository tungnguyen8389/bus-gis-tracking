// --------------------------------------------------------------------
// TOAST NOTIFICATION UTILITY
// --------------------------------------------------------------------
const TOAST_ICONS = {
  info: "fa-info-circle",
  success: "fa-circle-check",
  error: "fa-triangle-exclamation",
  warning: "fa-circle-exclamation"
};

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;

  const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
