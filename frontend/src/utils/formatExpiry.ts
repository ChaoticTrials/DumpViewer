/**
 * Format a future (or past) expiry date as a human-readable relative string.
 * Examples: "In 3 days", "In 5 hours", "Expired"
 */
export function formatRelativeExpiry(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';

  const totalHours = diffMs / (1000 * 60 * 60);
  if (totalHours < 24) {
    const h = Math.floor(totalHours);
    return `In ${h} hour${h !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(totalHours / 24);
  return `In ${days} day${days !== 1 ? 's' : ''}`;
}
