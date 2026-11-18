// On-device models fetched on first use (v1.4.5 QA, docs/11 §3.13). MediaPipe loads its runtime through a <script>
// and never settles when that fails: offline before the first use, "Hide faces", "Cutout" and "Auto reframe" waited
// forever with no word. A load that has said nothing for a while fails with a message that says what to do. Not one
// that is slow: on the iPhone a 60 s limit on the whole load ended a download that was still coming (SW-L-3).
import { MediaError } from './media';
import { NOT_ANSWERING, OFFLINE } from './watchedFetch';

const offline = () => new MediaError(OFFLINE);

/** Offline, a failed fetch ("Failed to fetch dynamically imported module …") becomes a message that says what to do. */
export const offlineAware = <T>(load: Promise<T>): Promise<T> => load.catch((e: unknown) => { throw navigator.onLine ? e : offline(); });

/**
 * `offlineAware`, and a load that has not moved for `quietMs` fails too (MediaPipe's never settles on a failed script).
 * `load` gets `alive`, to call whenever it moves (a piece of its download came). A model that arrives after the
 * failure is handed to `release`, so it does not stay in memory unused.
 */
export function modelLoad<T>(load: (alive: () => void) => Promise<T>, release: (late: T) => void, quietMs = navigator.onLine ? 60_000 : 20_000): Promise<T> {
  let timer = 0;
  let fail: (e: Error) => void = () => undefined;
  const late = new Promise<never>((_, reject) => { fail = reject; });
  const watch = () => {
    clearTimeout(timer);
    timer = self.setTimeout(() => fail(navigator.onLine ? new MediaError(NOT_ANSWERING) : offline()), quietMs);
  };
  watch();
  const loading = load(watch);
  void late.catch(() => loading.then(release, () => undefined));
  return Promise.race([offlineAware(loading), late]).finally(() => clearTimeout(timer));
}
