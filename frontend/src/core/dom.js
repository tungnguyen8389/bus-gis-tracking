export const byId = id => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Nạp các section HTML (partial) vào chỗ giữ chỗ <div data-section="name">.
 * Placeholder được thay bằng nguyên nội dung file → cấu trúc DOM giống hệt khi viết inline.
 * @param {string} baseUrl  import.meta.url của view, để resolve "./sections/<name>.html"
 */
export async function mountSections(baseUrl) {
  const slots = [...document.querySelectorAll("[data-section]")];
  const htmls = await Promise.all(slots.map(async slot => {
    const url = new URL(`./sections/${slot.dataset.section}.html`, baseUrl);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Không tải được section ${slot.dataset.section} (${res.status})`);
    return res.text();
  }));
  slots.forEach((slot, i) => { slot.outerHTML = htmls[i]; });
}
