const http = require("http");
const { Server } = require("socket.io");
const { PORT } = require("./src/config/env");

if (!process.env.JWT_SECRET) {
  console.warn(">>> [Cảnh báo] Chưa đặt JWT_SECRET trong .env — đang dùng khóa mặc định, không dùng cho môi trường thật.");
}
const { initDatabase } = require("./src/config/db");
const app = require("./src/app");
const registerTrackingSocket = require("./src/sockets/tracking.socket");

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

initDatabase();
registerTrackingSocket(io);

server.listen(PORT, () => {
  console.log(`>>> Máy chủ Web GIS & Admin Hub đang hoạt động tại: http://localhost:${PORT}`);
});
