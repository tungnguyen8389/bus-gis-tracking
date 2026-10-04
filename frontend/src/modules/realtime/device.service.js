const CONNECT_TIMEOUT_MS = 10000;

/**
 * Kết nối namespace /device bằng token tài xế (window.io nạp từ CDN socket.io trong <head>).
 * Resolve khi kết nối lần đầu; reject Error(message = UNAUTHORIZED | NO_VEHICLE | SERVER_ERROR | TIMEOUT).
 * onReconnect(socket): chạy mỗi lần kết nối lại — trip gắn với socket trên server nên phải gửi lại trip:start.
 * onRejected(err, socket): sau lần kết nối đầu, server từ chối handshake khi kết nối lại (err.message = UNAUTHORIZED |
 * NO_VEHICLE | SERVER_ERROR); socket không tự thử lại nên nơi gọi phải quyết định (socket.connect() hoặc dừng phát).
 */
export function connectDevice(token, { onReconnect, onReplaced, onRejected } = {}) {
  // forceNew: tách Manager riêng — trang còn socket viewer "/"; nếu dùng chung Manager thì khi server
  // ngắt /device (session:replaced) cả Manager đóng, feed bản đồ chết và không tự kết nối lại
  const socket = window.io("/device", { auth: { token }, reconnection: true, timeout: 5000, forceNew: true });
  let connectedOnce = false;
  socket.on("connect", () => {
    if (connectedOnce && onReconnect) onReconnect(socket);
    connectedOnce = true;
  });
  if (onReplaced) socket.on("session:replaced", onReplaced);
  // Listener bền vững: lỗi mạng (socket.active = true) vẫn tự thử lại, chỉ báo khi server từ chối hẳn
  if (onRejected) socket.on("connect_error", err => { if (connectedOnce && !socket.active) onRejected(err, socket); });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onOk);
      socket.off("connect_error", onError);
    };
    const fail = err => { cleanup(); socket.disconnect(); reject(err); };
    const onOk = () => { cleanup(); resolve(socket); };
    // socket.active = false: server từ chối handshake (không tự thử lại); true: lỗi mạng, đang thử lại
    const onError = err => { if (!socket.active) fail(err); };
    const timer = setTimeout(() => fail(new Error("TIMEOUT")), CONNECT_TIMEOUT_MS);
    socket.on("connect", onOk);
    socket.on("connect_error", onError);
  });
}

// Gửi sự kiện chờ ack, quá 5 s → reject
export function emitWithAck(socket, event, payload) {
  return socket.timeout(5000).emitWithAck(event, payload);
}
