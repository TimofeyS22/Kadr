// WebGL2 compositor: draws a FrameDesc with transforms, color grading, chroma key, wipes and blend modes.
import type { FrameDesc, Layer } from '../core/frame';
import { ADJUST_KEYS, type BlendMode } from '../core/types';
import type { Drawable } from './text';

const VS = `#version 300 es
in vec2 aPos;
uniform vec2 uRes, uCenter, uSize;
uniform float uRot;
uniform vec4 uCrop;
out vec2 vUv;
out vec2 vQuad;
out vec2 vCanvas;
void main() {
  vQuad = aPos + 0.5;
  vUv = uCrop.xy + vQuad * uCrop.zw;
  vec2 p = aPos * uSize;
  float c = cos(uRot), s = sin(uRot);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + uCenter;
  vCanvas = p / uRes;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vCanvas;
in vec2 vQuad;
out vec4 outColor;
uniform sampler2D uSegTex;
uniform int uHasSeg;
uniform int uMaskShape;
uniform vec4 uMaskRect;
uniform vec4 uMaskParams;
uniform sampler2D uTex;
uniform int uSolid;
uniform vec4 uColor;
uniform float uOpacity;
uniform float uBlurLod;
uniform vec2 uTexel;
uniform float uAdj[12];
uniform int uHasAdj;
uniform vec4 uKey;
uniform int uHasKey;
uniform float uKeySoft;
uniform vec3 uWipe;
uniform int uHasWipe;
uniform float uSeed;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 chroma(vec3 c) { return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081))); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
vec4 unpremul(vec4 s) { return vec4(s.a > 0.0 ? s.rgb / s.a : vec3(0.0), s.a); }

// Shape mask in layer space: 1 = circle/ellipse, 2 = rounded rectangle, 3 = linear gradient edge.
float shapeMask(vec2 q) {
  vec2 hs = max(uMaskRect.zw * 0.5, vec2(1e-4));
  float cs = cos(-uMaskParams.x), sn = sin(-uMaskParams.x);
  vec2 p = q - uMaskRect.xy;
  p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  float f = max(uMaskParams.y, 0.002);
  float m;
  if (uMaskShape == 1) {
    float d = length(p / hs);
    m = 1.0 - smoothstep(1.0 - f * 2.0, 1.0 + f * 2.0, d);
  } else if (uMaskShape == 2) {
    float r = uMaskParams.z * min(hs.x, hs.y);
    vec2 b = abs(p) - hs + r;
    float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - r;
    m = 1.0 - smoothstep(-f, f, d);
  } else {
    m = 1.0 - smoothstep(-f, f, p.y);
  }
  return uMaskParams.w > 0.5 ? 1.0 - m : m;
}

void main() {
  vec4 src;
  if (uSolid == 1) src = uColor;
  else if (uBlurLod > 0.0) {
    src = vec4(0.0);
    vec2 r = uTexel * exp2(uBlurLod);
    for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
      src += textureLod(uTex, vUv + vec2(float(i), float(j)) * r * 0.6, uBlurLod);
    src = unpremul(src / 25.0);
    src.rgb *= 0.75;
  } else src = unpremul(texture(uTex, vUv));
  vec3 c = src.rgb;
  float a = src.a;
  if (uHasAdj == 1) {
    if (uAdj[10] > 0.0) {
      vec3 n = texture(uTex, vUv + vec2(uTexel.x, 0.0)).rgb + texture(uTex, vUv - vec2(uTexel.x, 0.0)).rgb
        + texture(uTex, vUv + vec2(0.0, uTexel.y)).rgb + texture(uTex, vUv - vec2(0.0, uTexel.y)).rgb;
      c += (c - n * 0.25) * uAdj[10] * 2.0;
    }
    c *= exp2(uAdj[0] * 1.5);
    c += uAdj[1] * 0.2;
    c = (c - 0.5) * (1.0 + uAdj[2]) + 0.5;
    float l = luma(c);
    c += uAdj[7] * 0.3 * (1.0 - smoothstep(0.0, 0.55, l));
    c += uAdj[6] * 0.3 * smoothstep(0.45, 1.0, l);
    c += vec3(uAdj[4] * 0.08, -uAdj[5] * 0.06, -uAdj[4] * 0.08);
    c = mix(vec3(luma(c)), c, 1.0 + uAdj[3]);
    c = mix(c, c * 0.8 + 0.12, uAdj[8]);
    c *= 1.0 - uAdj[9] * smoothstep(0.3, 0.85, length(vUv - 0.5) * 1.3);
    c += (hash(vUv * 1024.0) - 0.5) * uAdj[11] * 0.22;
    c = clamp(c, 0.0, 1.0);
  }
  if (uHasKey == 1) {
    float d = distance(chroma(c), chroma(uKey.rgb));
    float k = smoothstep(uKey.a * 0.4, uKey.a * 0.4 + max(0.002, uKeySoft * 0.3), d);
    a *= k;
    c = mix(vec3(luma(c)), c, k);
  }
  if (uHasSeg == 1) a *= smoothstep(0.3, 0.7, texture(uSegTex, vUv).r);
  if (uMaskShape > 0) a *= shapeMask(vQuad);
  if (uHasWipe == 1) {
    float s = uWipe.x > 0.5 ? vCanvas.x : uWipe.x < -0.5 ? 1.0 - vCanvas.x : uWipe.y > 0.5 ? vCanvas.y : 1.0 - vCanvas.y;
    a *= 1.0 - smoothstep(uWipe.z - 0.01, uWipe.z + 0.01, s);
  }
  a *= uOpacity;
  outColor = vec4(c * a, a);
}`;

const FULL = { x: 0, y: 0, w: 1, h: 1 };

export interface LayerBounds { id: string; cx: number; cy: number; w: number; h: number; rot: number }

interface Slot { tex: WebGLTexture; key: string; w: number; h: number; mips: boolean; lastFrame: number; seg?: WebGLTexture; segKey?: string }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function slotOf(l: Layer): string | null {
  switch (l.source.kind) {
    case 'video': return `v:${l.source.clipId}`;
    case 'image': return `i:${l.source.assetId}`;
    case 'text': return `t:${l.source.clip.id}`;
    case 'caption': return `c:${l.source.clip.id}`;
    case 'solid': return null;
  }
}

export class Compositor {
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  private slots = new Map<string, Slot>();
  private frameNo = 0;
  lost = false;

  constructor(readonly canvas: HTMLCanvasElement, private preserve = false) {
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.init(); });
    this.init();
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: this.preserve, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.enable(gl.BLEND);
    this.u.clear();
    this.slots.clear();
    this.lost = false;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.u.get(name)!;
  }

  private upload(slotId: string, d: Drawable, mips: boolean): Slot {
    const gl = this.gl;
    let s = this.slots.get(slotId);
    if (!s) {
      const tex = gl.createTexture()!;
      s = { tex, key: '', w: 0, h: 0, mips: false, lastFrame: 0 };
      this.slots.set(slotId, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    if (s.key !== d.key || (mips && !s.mips)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, d.image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      Object.assign(s, { key: d.key, w: d.w, h: d.h, mips });
    }
    s.lastFrame = this.frameNo;
    if (d.seg && s.segKey !== d.seg.key) {
      s.seg ??= gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, s.seg);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, d.seg.w, d.seg.h, 0, gl.RED, gl.UNSIGNED_BYTE, d.seg.data);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.activeTexture(gl.TEXTURE0);
      s.segKey = d.seg.key;
    }
    return s;
  }

  private blend(mode: BlendMode): void {
    const gl = this.gl;
    switch (mode) {
      case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  /** Draws the frame; returns on-canvas bounds of selectable layers (for hit testing). */
  draw(desc: FrameDesc, sources: Map<string, Drawable>): LayerBounds[] {
    if (this.lost) return [];
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    this.frameNo++;
    gl.viewport(0, 0, W, H);
    const [br, bg, bb] = hexToRgb(desc.background);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.loc('uRes'), W, H);
    gl.uniform1f(this.loc('uSeed'), (desc.t * 60) % 97);
    gl.uniform1i(this.loc('uTex'), 0);
    gl.uniform1i(this.loc('uSegTex'), 1);
    const needMips = new Set(desc.layers.filter((l) => l.blur).map(slotOf));
    const bounds: LayerBounds[] = [];

    for (const l of desc.layers) {
      if (l.opacity <= 0.001) continue;
      let sw = W, sh = H;
      const slotId = slotOf(l);
      if (l.source.kind === 'solid') {
        gl.uniform1i(this.loc('uSolid'), 1);
        gl.uniform1i(this.loc('uHasSeg'), 0);
        const [r, g, b] = hexToRgb(l.source.color);
        gl.uniform4f(this.loc('uColor'), r, g, b, 1);
      } else {
        const d = slotId ? sources.get(slotId) : undefined;
        if (!d || !slotId) continue;
        const s = this.upload(slotId, d, needMips.has(slotId));
        const seg = l.removeBg && d.seg && s.seg ? s.seg : null;
        gl.uniform1i(this.loc('uHasSeg'), seg ? 1 : 0);
        if (seg) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, seg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex); }
        gl.uniform1i(this.loc('uSolid'), 0);
        gl.uniform2f(this.loc('uTexel'), 1 / s.w, 1 / s.h);
        const c = l.crop ?? FULL;
        sw = s.w * c.w; sh = s.h * c.h;
      }
      const base = l.fit === 'native' ? 1 : l.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      const w = sw * base * l.scale, h = sh * base * l.scale;
      const cx = W / 2 + l.x * W, cy = H / 2 + l.y * H;
      const rot = (l.rotation * Math.PI) / 180;
      const cr = l.crop ?? FULL;
      gl.uniform4f(this.loc('uCrop'), cr.x, cr.y, cr.w, cr.h);
      gl.uniform2f(this.loc('uCenter'), cx, cy);
      gl.uniform2f(this.loc('uSize'), w, h);
      gl.uniform1f(this.loc('uRot'), rot);
      gl.uniform1f(this.loc('uOpacity'), l.opacity);
      gl.uniform1f(this.loc('uBlurLod'), l.blur ? Math.max(1, Math.log2(Math.max(sw, sh) / 20)) : 0);
      gl.uniform1i(this.loc('uHasAdj'), l.adjust ? 1 : 0);
      if (l.adjust) gl.uniform1fv(this.loc('uAdj'), ADJUST_KEYS.map((k) => l.adjust![k]));
      gl.uniform1i(this.loc('uHasKey'), l.chroma ? 1 : 0);
      if (l.chroma) {
        gl.uniform4f(this.loc('uKey'), ...hexToRgb(l.chroma.color), l.chroma.similarity);
        gl.uniform1f(this.loc('uKeySoft'), l.chroma.smoothness);
      }
      const mk = l.mask;
      gl.uniform1i(this.loc('uMaskShape'), mk ? { circle: 1, rect: 2, linear: 3 }[mk.shape] : 0);
      if (mk) {
        gl.uniform4f(this.loc('uMaskRect'), mk.x, mk.y, mk.w, mk.h);
        gl.uniform4f(this.loc('uMaskParams'), (mk.rotation * Math.PI) / 180, mk.feather, mk.roundness, mk.invert ? 1 : 0);
      }
      gl.uniform1i(this.loc('uHasWipe'), l.wipe ? 1 : 0);
      gl.uniform3f(this.loc('uWipe'), ...(l.wipe ?? [0, 0, 0]));
      this.blend(l.blend);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (l.selectable) bounds.push({ id: l.id, cx, cy, w, h, rot });
    }
    for (const [id, s] of this.slots) {
      if (this.frameNo - s.lastFrame > 90) { gl.deleteTexture(s.tex); if (s.seg) gl.deleteTexture(s.seg); this.slots.delete(id); }
    }
    return bounds;
  }

  /** Frees textures; `loseContext` also releases the GPU context (only for canvases that are thrown away). */
  dispose(loseContext = false): void {
    for (const s of this.slots.values()) this.gl.deleteTexture(s.tex);
    this.slots.clear();
    if (loseContext) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
