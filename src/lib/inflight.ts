type Pending<T> = Promise<T>;

const inFlight = new Map<string, Pending<unknown>>();

export function shareInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Pending<T> | undefined;
  if (existing) return existing;

  const pending = run();
  inFlight.set(key, pending);
  pending.then(
    () => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    },
    () => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  );
  return pending;
}
