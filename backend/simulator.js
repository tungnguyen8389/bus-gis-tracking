const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");

// Lộ trình số hóa mẫu cho các tuyến ĐHQG
const routesData = {
  BUS_01: [
    [106.795000, 10.863000],
    [106.796500, 10.864500],
    [106.798000, 10.866000],
    [106.799000, 10.868000],
    [106.800000, 10.870000],
    [106.801000, 10.870300],
    [106.801960, 10.870525],
    [106.802500, 10.874000],
    [106.803300, 10.877800],
    [106.804500, 10.873000],
    [106.805500, 10.868500]
  ],
  BUS_02: [
    [106.795000, 10.863000],
    [106.798000, 10.866000],
    [106.801000, 10.869000],
    [106.801960, 10.870525],
    [106.805000, 10.875000],
    [106.809000, 10.879000]
  ],
  BUS_03: [
    [106.802000, 10.873000],
    [106.803300, 10.877800],
    [106.805500, 10.868500],
    [106.807000, 10.874000],
    [106.809000, 10.879000]
  ]
};

// Cấu hình các xe buýt hoạt động trên các tuyến
const activeBuses = [
  { vehicle_id: "BUS_51B_01", plate_number: "51B-123.45", route_id: "BUS_01", step: 0, speed: 32 },
  { vehicle_id: "BUS_51B_02", plate_number: "51B-678.90", route_id: "BUS_01", step: 4, speed: 28 },
  { vehicle_id: "BUS_51B_03", plate_number: "51B-888.99", route_id: "BUS_02", step: 1, speed: 35 },
  { vehicle_id: "BUS_51B_04", plate_number: "51B-456.78", route_id: "BUS_03", step: 2, speed: 30 }
];

socket.on("connect", () => {
  console.log(">>> Đã kết nối tới Socket Hub (http://localhost:3000). Bắt đầu phát luồng tín hiệu GPS xe buýt...");

  // Định kỳ phát vị trí mỗi 2 giây
  setInterval(() => {
    activeBuses.forEach((bus) => {
      const waypoints = routesData[bus.route_id] || routesData.BUS_01;
      const currentCoord = waypoints[bus.step];
      const nextCoord = waypoints[(bus.step + 1) % waypoints.length];

      // Tính góc quay (Heading)
      const dLon = nextCoord[0] - currentCoord[0];
      const dLat = nextCoord[1] - currentCoord[1];
      const heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;

      const packet = {
        vehicle_id: bus.vehicle_id,
        plate_number: bus.plate_number,
        route_id: bus.route_id,
        longitude: currentCoord[0],
        latitude: currentCoord[1],
        speed_kmh: bus.speed + Math.floor(Math.random() * 5 - 2),
        heading: parseFloat(heading.toFixed(1)),
        timestamp: new Date().toISOString()
      };

      socket.emit("gps_ping", packet);
      console.log(`[GPS Stream] [${bus.route_id}] ${bus.plate_number} -> [${packet.longitude.toFixed(6)}, ${packet.latitude.toFixed(6)}] | ${packet.speed_kmh} km/h | Hướng: ${packet.heading}°`);

      // Dịch chuyển đến điểm tiếp theo
      bus.step = (bus.step + 1) % waypoints.length;
    });
  }, 2000);
});

socket.on("connect_error", (err) => {
  console.error(">>> [Simulator Lỗi] Không thể kết nối tới Server:", err.message);
});
