// Trạng thái dùng chung giữa các feature của trang tài xế (đọc/ghi qua thuộc tính)
export const state = {
  user: null,          // { user_id, username, full_name }
  vehicle: null,       // { vehicle_id, plate_number }
  schedules: [],       // lịch trình của xe
  schedule: null,      // lịch trình đang chạy
  broadcasting: false  // trang này đang phát GPS điện thoại qua /device
};
