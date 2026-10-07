// Thông báo lỗi định vị (GeolocationPositionError: 1 từ chối, 2 không xác định, 3 hết giờ)
export function geolocationErrorMessage(err) {
  const code = err?.code ?? err?.details?.code ?? err?.details?.error?.code;
  if (code === 1) return "Bạn đã từ chối quyền truy cập vị trí. Hãy cho phép trong cài đặt trình duyệt.";
  if (code === 2) return "Không xác định được vị trí hiện tại. Kiểm tra GPS / kết nối mạng.";
  if (code === 3) return "Hết thời gian chờ định vị. Vui lòng thử lại.";
  return "Không thể định vị vị trí của bạn.";
}
