const test = require("node:test");
const assert = require("node:assert/strict");
const { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule } = require("./schedule");

const S = [
  { schedule_id: 3, departure_time: "07:00" },
  { schedule_id: 1, departure_time: "05:00" },
  { schedule_id: 2, departure_time: "06:00" }
];

test("toMinutes / vnMinutesOfDay", () => {
  assert.equal(toMinutes("06:30"), 390);
  assert.equal(vnMinutesOfDay(Date.UTC(2026, 9, 5, 3, 0, 0)), 600);    // 10:00 VN
  assert.equal(vnMinutesOfDay(Date.UTC(2026, 9, 5, 17, 5, 0)), 5);     // 00:05 VN
});

test("pickSchedule: trước chuyến đầu → chuyến đầu; giữa ngày → chuyến gần nhất đã tới giờ; sau chuyến cuối → chuyến cuối", () => {
  assert.equal(pickSchedule(S, 4 * 60).schedule_id, 1);
  assert.equal(pickSchedule(S, 6 * 60).schedule_id, 2);
  assert.equal(pickSchedule(S, 6 * 60 + 59).schedule_id, 2);
  assert.equal(pickSchedule(S, 23 * 60).schedule_id, 3);
  assert.equal(pickSchedule([], 600), null);
});

test("nextSchedule: chuyến kế tiếp theo giờ, hết thì null", () => {
  assert.equal(nextSchedule(S, S[1]).schedule_id, 2);
  assert.equal(nextSchedule(S, S[0]), null);
});
