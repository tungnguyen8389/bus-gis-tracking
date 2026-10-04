const test = require("node:test");
const assert = require("node:assert/strict");
const { requireRole, requireStaff } = require("./auth");

// Chạy middleware với req.user giả, ghi lại status và việc gọi next()
function run(middleware, user) {
  const result = { status: null, nextCalled: false };
  const res = {
    status(code) { result.status = code; return this; },
    json() { return this; }
  };
  middleware({ user }, res, () => { result.nextCalled = true; });
  return result;
}

test("requireRole cho qua khi role khớp", () => {
  assert.deepEqual(run(requireRole("DRIVER"), { role: "DRIVER" }), { status: null, nextCalled: true });
});

test("requireRole chặn 403 khi role không khớp", () => {
  assert.deepEqual(run(requireRole("DRIVER"), { role: "ADMIN" }), { status: 403, nextCalled: false });
});

test("requireRole chặn 403 khi thiếu req.user", () => {
  assert.deepEqual(run(requireRole("ADMIN"), undefined), { status: 403, nextCalled: false });
});

test("requireStaff cho ADMIN và MANAGER, chặn DRIVER và VIEWER", () => {
  assert.equal(run(requireStaff, { role: "ADMIN" }).nextCalled, true);
  assert.equal(run(requireStaff, { role: "MANAGER" }).nextCalled, true);
  assert.equal(run(requireStaff, { role: "DRIVER" }).status, 403);
  assert.equal(run(requireStaff, { role: "VIEWER" }).status, 403);
});
