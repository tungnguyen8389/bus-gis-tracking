// ---
// REGISTRY CHUYẾN ĐANG CHẠY (bộ nhớ, 1 process): schedule_id → xe, vị trí cuối, mẫu vận tốc.
// Không chiếu tọa độ lên lộ trình ở đây — việc đó để lúc tính ETA cho vòng GPS luôn nhẹ.
// ---
const { EventEmitter } = require("node:events");

const SAMPLE_INTERVAL_MS = 15000;
const SAMPLE_WINDOW_MS = 5 * 60 * 1000;

function createTripRegistry({ now = Date.now } = {}) {
  const trips = new Map();
  const events = new EventEmitter();
  const changed = trip => events.emit("change", { route_id: trip.route_id, direction: trip.direction });

  return {
    start({ schedule_id, vehicle_id, route_id, direction }) {
      if (trips.has(schedule_id)) return;
      const trip = {
        schedule_id, vehicle_id, route_id, direction,
        started_at: now(), last_position: null, samples: [], speed_sum: 0, speed_count: 0
      };
      trips.set(schedule_id, trip);
      changed(trip);
    },

    end(scheduleId) {
      const trip = trips.get(scheduleId);
      if (!trip) return;
      trips.delete(scheduleId);
      changed(trip);
    },

    recordPing(scheduleId, { longitude, latitude, speed_kmh }) {
      const trip = trips.get(scheduleId);
      if (!trip) return;
      const t = now();
      trip.last_position = { t, longitude, latitude };
      if (speed_kmh > 0) {
        trip.speed_sum += speed_kmh;
        trip.speed_count += 1;
      }
      const lastSample = trip.samples[trip.samples.length - 1];
      if (!lastSample || t - lastSample.t >= SAMPLE_INTERVAL_MS) trip.samples.push({ t, longitude, latitude });
      while (trip.samples.length > 0 && t - trip.samples[0].t > SAMPLE_WINDOW_MS) trip.samples.shift();
    },

    get: scheduleId => trips.get(scheduleId),
    has: scheduleId => trips.has(scheduleId),
    listByRoute: (routeId, direction) =>
      [...trips.values()].filter(t => t.route_id === routeId && (direction === undefined || t.direction === direction)),
    on: (event, fn) => events.on(event, fn)
  };
}

module.exports = { createTripRegistry, SAMPLE_INTERVAL_MS, SAMPLE_WINDOW_MS };
