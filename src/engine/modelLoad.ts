// On-device models fetched on first use (v1.4.5 QA, docs/11 §3.13). MediaPipe loads its runtime through a <script>
// and never settles when that fails: offline before the first use, "Hide faces", "Cutout" and "Auto reframe" waited
// forever with no word. A load that has not finished in time fails with a message that says what to do.
import { MediaError } from './media';

const offline = () => new MediaError('No internet. This tool downloads its model once; after that it works offline.');

/** Offline, a failed fetch ("Failed to fetch dynamically imported module …") becomes a message that says what to do. */
export const offlineAware = <T>(load: Promise<T>): Promise<T> => load.catch((e: unknown) => { throw navigator.onLine ? e : offline(); });

/**
 * `offlineAware`, and a load still pending after `ms` fails too (MediaPipe's never settles on a failed script).
 * A model that arrives after that is handed to `release`, so it does not stay in memory unused.
 */
export function modelLoad<T>(load: Promise<T>, release: (late: T) => void, ms = navigator.onLine ? 60_000 : 20_000): Promise<T> {
  let timer = 0;
  const late = new Promise<never>((_, reject) => {
    timer = self.setTimeout(() => {
      void load.then(release, () => undefined);
      reject(navigator.onLine
        ? new MediaError('The on-device model did not load. Check the connection and try again.')
        : offline());
    }, ms);
  });
  return Promise.race([offlineAware(load), late]).finally(() => clearTimeout(timer));
}
