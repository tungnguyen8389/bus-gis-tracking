const http = require("http");
const { Server } = require("socket.io");
const { PORT, CORS_ORIGIN } = require("./src/config/env");
const { initDatabase } = require("./src/config/db");
const app = require("./src/app");
const { registerSockets } = require("./src/sockets");

if (!process.env.JWT_SECRET) {
  console.warn(">>> [Cảnh báo] Chưa đặt JWT_SECRET trong .env — đang dùng khóa mặc định, không dùng cho môi trường thật.");
}

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024, // Gói GPS chỉ vài trăm byte
  ...(CORS_ORIGIN ? { cors: { origin: CORS_ORIGIN } } : {})
});

initDatabase();
registerSockets(io);

server.listen(PORT, () => {
  console.log(`>>> Máy chủ Web GIS & Admin Hub đang hoạt động tại: http://localhost:${PORT}`);
});
