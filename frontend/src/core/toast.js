// --------------------------------------------------------------------
// TOAST NOTIFICATION UTILITY (cần phần tử #toastContainer trên trang)
// --------------------------------------------------------------------
export function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;

  let icon = "fa-info-circle";
  if (type === "success") icon = "fa-circle-check";
  if (type === "error") icon = "fa-triangle-exclamation";
  if (type === "warning") icon = "fa-circle-exclamation";

  // Nội dung là văn bản thuần (có thể chứa tên người dùng, biển số...) → không chèn HTML
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
