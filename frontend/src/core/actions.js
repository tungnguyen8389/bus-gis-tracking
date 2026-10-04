// Ủy quyền sự kiện cho markup thay vì onclick/onchange inline:
//   data-action="fn"  (click)   data-change="fn"   data-input="fn"   data-submit="fn"
//   data-arg="..."    tham số tùy chọn, handler đọc qua el.dataset.arg
// Handler nhận (el, event), với el là phần tử mang thuộc tính data-*.
const handlers = {};

const EVENT_ATTRS = { click: "action", change: "change", input: "input", submit: "submit" };

export function registerActions(map) {
  Object.assign(handlers, map);
}

Object.entries(EVENT_ATTRS).forEach(([type, attr]) => {
  document.addEventListener(type, event => {
    const el = event.target.closest(`[data-${attr}]`);
    if (!el) return;
    const name = el.dataset[attr];
    const handler = handlers[name];
    if (!handler) {
      console.warn(`Chưa đăng ký handler "${name}" cho data-${attr}`);
      return;
    }
    handler(el, event);
  });
});
