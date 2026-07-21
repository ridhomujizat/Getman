export const DAY_MS = 24 * 60 * 60 * 1000;

export const shouldAutoCheck = (lastCheckedAt: number | null, now = Date.now()) =>
  lastCheckedAt == null || now - lastCheckedAt >= DAY_MS;
