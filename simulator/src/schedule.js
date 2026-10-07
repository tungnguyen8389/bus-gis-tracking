// Chọn chuyến theo giờ Việt Nam (UTC+7 cố định, không phụ thuộc múi giờ của máy chạy simulator)
const VN_OFFSET_MIN = 7 * 60;
const DAY_MIN = 1440;

const toMinutes = hhmm => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
const vnMinutesOfDay = nowMs => (((Math.floor(nowMs / 60000) + VN_OFFSET_MIN) % DAY_MIN) + DAY_MIN) % DAY_MIN;
const byTime = (a, b) => toMinutes(a.departure_time) - toMinutes(b.departure_time);

// Chuyến hiện tại: xuất bến muộn nhất nhưng không sau giờ hiện tại; trước chuyến đầu ngày → chuyến đầu
function pickSchedule(schedules, nowMin) {
  const sorted = [...schedules].sort(byTime);
  let current = sorted[0] || null;
  for (const s of sorted) if (toMinutes(s.departure_time) <= nowMin) current = s;
  return current;
}

function nextSchedule(schedules, current) {
  const t = toMinutes(current.departure_time);
  return [...schedules].sort(byTime).find(s => toMinutes(s.departure_time) > t) || null;
}

module.exports = { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule };
