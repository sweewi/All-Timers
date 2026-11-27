/** "just now", "12 min ago", "3 h ago", "2 days ago" */
export function timeAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "3 days", "5 h", "12 min": time left until ms */
export function timeLeft(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((ms - now) / 1000));
  const d = Math.floor(s / 86400);
  if (d >= 2) return `${d} days`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(s / 60))} min`;
}

export function compact(n: number) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
