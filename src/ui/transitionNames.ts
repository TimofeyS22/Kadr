// The names of the transitions, for the sheet that picks one and for the button on the seam that says which is there.
import type { TransitionType } from '../core/types';

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: 'Dissolve', black: 'Dip to black', white: 'Dip to white', slideLeft: 'Slide ←', slideRight: 'Slide →',
  slideUp: 'Slide ↑', slideDown: 'Slide ↓', wipeLeft: 'Wipe ←', wipeRight: 'Wipe →', zoom: 'Zoom',
  whip: 'Whip pan', spin: 'Spin', blur: 'Blur', glitch: 'Glitch', flash: 'Flash', circle: 'Circle', doors: 'Doors',
  pixelate: 'Pixelate', zoomOut: 'Zoom out', shake: 'Shake',
};
