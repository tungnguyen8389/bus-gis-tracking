const http = require("http");
const { Server } = require("socket.io");
const { PORT } = require("./src/config/env");
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
