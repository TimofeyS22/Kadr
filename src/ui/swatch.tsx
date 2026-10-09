// A text style drawn as itself (font, colour, outline, background, glow): used by the text and caption style pickers.
import type { TextStyle } from '../core/types';
import { fontOf, fontWeight } from '../engine/text';

const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

/** A text style drawn as itself on its button: font, colour, outline, background, glow. */
export function StyleSwatch({ style: st, label }: { style: TextStyle; label: string }) {
  return (
    <span className="style-swatch" style={{
      fontFamily: fontOf(st.font).family, fontWeight: fontWeight(st.font, st.weight), fontStyle: st.italic ? 'italic' : undefined,
      color: st.color, textTransform: st.uppercase ? 'uppercase' : undefined,
      background: st.background ? rgba(st.background.color, st.background.opacity) : undefined,
      WebkitTextStroke: st.stroke ? `${Math.max(0.6, st.stroke.width * 8)}px ${st.stroke.color}` : undefined, paintOrder: 'stroke fill',
      textShadow: st.shadowColor ? `0 0 6px ${st.shadowColor}` : st.shadow ? '0 1px 3px rgba(0, 0, 0, 0.8)' : undefined,
    }}>{label}</span>
  );
}
