// Tab Quản lý Người dùng (ADMIN)
import { state } from "../admin.state.js";
import { openModal, closeModal } from "../../../core/modal.js";
import { apiErrorMessage } from "../../../core/http.js";
import { listUsers, createUser, updateUser, deleteUser as removeUser } from "../../../modules/users/users.service.js";

export async function loadUsers() {
  try {
    state.users = await listUsers();
    const tbody = document.getElementById("users-table-body");
    tbody.innerHTML = state.users.map(u => `
        <tr>
          <td>${u.user_id}</td>
          <td><b>${u.username}</b></td>
          <td>${u.full_name}</td>
          <td>${u.email || "---"}</td>
          <td><span class="badge ${u.role === 'ADMIN' ? 'badge-admin' : 'badge-manager'}">${u.role}</span></td>
          <td>${new Date(u.created_at).toLocaleDateString("vi-VN")}</td>
          <td>
            <button class="btn btn-sm btn-primary" data-action="editUser" data-id="${u.user_id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-action="deleteUser" data-id="${u.user_id}"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `).join("");
  } catch (e) {}
}

export function openUserModal(editData = null) {
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

export function editUser(id) {
  const item = state.users.find(u => u.user_id === id);
  if (item) openUserModal(item);
}

export async function saveUser(e) {
  e.preventDefault();
  const userId = document.getElementById("edit_user_id").value;
  const isEdit = Boolean(userId);
  const payload = {
    username: document.getElementById("user_username").value,
    password: document.getElementById("user_password").value,
    full_name: document.getElementById("user_fullname").value,
    email: document.getElementById("user_email").value,
    role: document.getElementById("user_role").value
  };

  try {
    await (isEdit ? updateUser(userId, payload) : createUser(payload));
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi lưu người dùng"));
    return;
  }
  closeModal("modal-user");
  loadUsers();
}

export async function deleteUser(id) {
  if (!confirm(`Xóa tài khoản ID: ${id}?`)) return;
  try {
    await removeUser(id);
  } catch (err) {
    alert(apiErrorMessage(err, "Lỗi xóa người dùng"));
    return;
  }
  loadUsers();
}
