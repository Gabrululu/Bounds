type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after any write or incoming chain event so the UI refetches. */
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function emit() {
  listeners.forEach((l) => l());
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
