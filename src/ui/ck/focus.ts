// Where the focus goes back when a layer closes (a sheet, a question). Safari does not move the focus to a button that
// is tapped or clicked, so "what had the focus before" is the page itself there: the layer remembers what was pressed
// last instead. If that is gone by the time the layer closes, the screen says where to go.

let pressed: Element | null = null;
let listening = 0;
const note = (e: Event) => { pressed = e.target instanceof Element ? e.target.closest('button, a, [tabindex]') : null; };

/** Start noting what is pressed; the returned function stops. One listener for the whole page. */
export function watchPressed(): () => void {
  if (listening++ === 0) document.addEventListener('pointerdown', note, true);
  return () => { if (--listening === 0) document.removeEventListener('pointerdown', note, true); };
}

/** What opened a layer that is opening now. */
export function opener(): Element | null {
  const active = document.activeElement;
  return active && active !== document.body ? active : pressed;
}

/** Give the focus back to `to`, or to `fallback` when `to` has left the page. */
export function giveBack(to: Element | null, fallback?: () => HTMLElement | null | undefined) {
  const target = to instanceof HTMLElement && to.isConnected ? to : fallback?.();
  target?.focus({ preventScroll: true });
}
