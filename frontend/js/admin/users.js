// --------------------------------------------------------------------
// QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN (chỉ ADMIN)
// --------------------------------------------------------------------
let currentUsersList = [];

function userRowHtml(u) {
  return `
    <tr>
      <td>${u.user_id}</td>
      <td><b>${u.username}</b></td>
      <td>${u.full_name}</td>
      <td>${u.email || "---"}</td>
      <td><span class="badge ${u.role === 'ADMIN' ? 'badge-admin' : 'badge-manager'}">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString("vi-VN")}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="editUser(${u.user_id})"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.user_id})"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `;
}

async function loadUsers() {
  try {
    currentUsersList = await apiGetJson("/users", { auth: true });
    renderTableRows("users-table-body", currentUsersList, userRowHtml);
  } catch (e) {}
}

function openUserModal(editData = null) {
  document.getElementById("form-user").reset();
  const idInput = document.getElementById("edit_user_id");
  const usernameInput = document.getElementById("user_username");
  if (editData) {
    document.getElementById("modal-user-title").innerText = "Cập nhật Người dùng";
    idInput.value = editData.user_id;
    usernameInput.value = editData.username;
    usernameInput.disabled = true;
    document.getElementById("user_fullname").value = editData.full_name;
    document.getElementById("user_email").value = editData.email || "";
    document.getElementById("user_role").value = editData.role;
  } else {
    document.getElementById("modal-user-title").innerText = "Thêm Người Dùng Mới";
    idInput.value = "";
    usernameInput.disabled = false;
  }
  openModal("modal-user");
}

function editUser(id) {
  const item = currentUsersList.find(u => u.user_id === id);
  if (item) openUserModal(item);
}

async function saveUser(e) {
  e.preventDefault();
  const userId = document.getElementById("edit_user_id").value;
  const payload = {
    username: document.getElementById("user_username").value,
    password: document.getElementById("user_password").value,
    full_name: document.getElementById("user_fullname").value,
    email: document.getElementById("user_email").value,
    role: document.getElementById("user_role").value
  };

  if (await saveResource("/users", userId, Boolean(userId), payload, "Lỗi lưu người dùng")) {
    closeModal("modal-user");
    loadUsers();
  }
}

async function deleteUser(id) {
  if (!confirm(`Xóa tài khoản ID: ${id}?`)) return;
  const res = await apiRequest("DELETE", `/users/${id}`);
  if (res.ok) loadUsers();
  else {
    const err = await res.json();
    alert(err.error || "Lỗi xóa người dùng");
  }
}
