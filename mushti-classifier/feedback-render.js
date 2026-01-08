import { sortByStatus } from "./feedback-sort.js";

export function statusFromProgress(progress) {
  if (progress >= 1) return "is-met";
  if (progress >= 0.8) return "is-close";
  return "";
}

export function renderBulletList(items, { sort = true } = {}) {
  const listItems = (sort ? sortByStatus(items) : items)
    .map((item) => `<li class="${item.status}">${item.label}</li>`)
    .join("");
  return `<ul>${listItems}</ul>`;
}
