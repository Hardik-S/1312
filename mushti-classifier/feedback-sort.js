export function sortByStatus(items) {
  const rank = (item) => {
    if (item.status === "is-met") return 2;
    if (item.status === "is-close") return 1;
    return 0;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
