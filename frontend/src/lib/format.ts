/** "5 min ago" for a unix time in seconds. */
export function relativeTime(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}

/** Short form for tight lists: "2h", "3d". */
export function shortTime(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 7))}w`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export function plural(n: number, word: string, many = word + "s"): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Splits "frontend/src/App.tsx" into its folder and file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}
