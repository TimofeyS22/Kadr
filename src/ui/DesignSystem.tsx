// The gallery of the Chetko design system (`?ds`, docs/17 stage Ч2): every token as this device draws it, the pairs of
// colours with the contrast the browser itself computes, the sign. Not linked from the app. e2e reads `window.__ckDs`;
// the owner can open it on a phone. Screens of the product move onto these tokens one by one (stage Ч4).
import { useEffect, useRef, useState } from 'react';
import './ckFont';
import './tokens.css';
import './ds.css';
import { DsComponents } from './DsComponents';
import { DsParts } from './DsParts';
import { TOKEN_PAIRS } from './tokenPairs';

export interface DsPairRow { fg: string; bg: string; min: number; ratio: number; ok: boolean }
export interface DsReport { done: boolean; pairs: DsPairRow[]; fonts: { cyrillic: boolean; latin: boolean }; rootPx: number; userAgent: string }

const COLOURS: [string, string][] = [
  ['--surface-field', 'Поле вокруг кадра'], ['--surface-panel', 'Панель'], ['--surface-raised', 'Лист, плитка'], ['--border-subtle', 'Линии'],
  ['--text-primary', 'Текст'], ['--text-secondary', 'Второй план'], ['--text-disabled', 'Недоступное'], ['--action-primary', 'Главная кнопка'],
  ['--mark-was', 'Метка «было»'], ['--signal', 'Метка «стало», цифра'], ['--action-danger', 'Удаление'], ['--tick-major', 'Деления крупные'], ['--tick-minor', 'Деления мелкие'],
];
const TYPE: [string, string][] = [['--type-xs', '12'], ['--type-sm', '14'], ['--type-md', '16'], ['--type-lg', '20'], ['--type-xl', '28'], ['--type-display', '56']];
const RADII = ['--radius-clip', '--radius-control', '--radius-sheet'];
const SPACE = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8'];
const MOTION: [string, string][] = [
  ['--dur-press', 'Нажатие'], ['--dur-snap', 'Остановка на исходном'], ['--dur-value', 'Цифра наводится на резкость'], ['--dur-undo', 'Отмена'],
  ['--dur-mode', 'Открыть значение'], ['--dur-sheet-in', 'Лист выезжает'], ['--dur-sheet-out', 'Лист уходит'],
];

/** The colour a token resolves to on this device, as sRGB bytes: the browser does the conversion from OKLCH, a canvas reads it. */
function tokenRgb(scope: HTMLElement, ctx: CanvasRenderingContext2D, token: string): [number, number, number] {
  const probe = document.createElement('i');
  probe.style.color = `var(${token})`;
  scope.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function Wordmark() {
  return <span className="ck-wm" role="img" aria-label="Чётко">Ч<span className="ck-yo">е</span>тко</span>;
}

export function DesignSystem() {
  const root = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<DsReport | null>(null);
  const [swatches, setSwatches] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState(false);
  const [played, setPlayed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const el = root.current;
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!el || !ctx) return;
      await Promise.all([document.fonts.load('700 28px Geologica', 'Чётко'), document.fonts.load('700 28px Geologica', 'Split')]).catch(() => undefined);
      if (!alive) return;
      const seen: Record<string, string> = {};
      for (const [token] of COLOURS) seen[token] = hex(tokenRgb(el, ctx, token));
      const pairs = TOKEN_PAIRS.map((p): DsPairRow => {
        const a = luminance(tokenRgb(el, ctx, p.fg)), b = luminance(tokenRgb(el, ctx, p.bg));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        return { fg: p.fg, bg: p.bg, min: p.min, ratio: Math.round(ratio * 100) / 100, ok: ratio >= p.min };
      });
      const next: DsReport = {
        done: true, pairs,
        fonts: { cyrillic: document.fonts.check('700 28px Geologica', 'Чётко'), latin: document.fonts.check('700 28px Geologica', 'Split') },
        rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize), userAgent: navigator.userAgent,
      };
      (window as unknown as { __ckDs?: DsReport }).__ckDs = next;
      setSwatches(seen);
      setReport(next);
    })();
    return () => { alive = false; };
  }, []);

  const failed = report?.pairs.filter((p) => !p.ok).length ?? 0;
  return (
    <div className="ck ds" ref={root}>
      <div className="ds-in">
        <header>
          <h1><Wordmark /></h1>
          <p className="ds-dim">Дизайн-система: токены и компоненты. {report ? (failed ? `Пар ниже порога: ${failed}.` : `Все ${report.pairs.length} пар проходят порог контраста.`) : 'Считаю контраст…'}</p>
        </header>

        <section>
          <h2>Знак</h2>
          <p className="ds-dim">Точки над «ё» — метки входа и выхода. То, что лежит между двумя метками, держится: кусок, экспорт, значение.</p>
          <div className="ds-tiles">
            <div className="ds-tile"><span style={{ fontSize: 'var(--type-display)' }}><Wordmark /></span></div>
            <div className="ds-tile ds-field"><div className="ds-strip ck-held" /></div>
            <div className="ds-tile"><div className="ds-icon"><i /><i /></div></div>
          </div>
        </section>

        <section>
          <h2>Цифра значения</h2>
          <div className="ds-row">
            <span className="ck-digit" data-moving={moving}>+35</span>
            <span className="ck-digit" data-moving={moving}>1,5×</span>
            <button className="ds-btn" onPointerDown={() => setMoving(true)} onPointerUp={() => setMoving(false)} onPointerLeave={() => setMoving(false)} onPointerCancel={() => setMoving(false)}>Держите: значение в движении</button>
          </div>
        </section>

        <DsComponents />
        <DsParts />

        <section>
          <h2>Цвет</h2>
          <div className="ds-scroll"><table>
            <thead><tr><th>Образец</th><th>Токен</th><th>Назначение</th><th>На этом устройстве</th></tr></thead>
            <tbody>{COLOURS.map(([token, what]) => (
              <tr key={token}><td><div className="ds-sw" style={{ background: `var(${token})` }} /></td><td><code>{token}</code></td><td>{what}</td><td className="ds-num ds-dim">{swatches[token] ?? '…'}</td></tr>
            ))}</tbody>
          </table></div>
          <h3>Пары и контраст</h3>
          <div className="ds-scroll"><table>
            <thead><tr><th>Пара</th><th>Что это</th><th>Порог</th><th>Контраст</th></tr></thead>
            <tbody>{TOKEN_PAIRS.map((p, i) => {
              const r = report?.pairs[i];
              return (
                <tr key={`${p.fg}/${p.bg}`}>
                  <td><div className="ds-sw" style={{ background: `var(${p.bg})`, color: `var(${p.fg})` }}>Чё</div></td>
                  <td>{p.what}<br /><code>{p.fg} на {p.bg}</code></td>
                  <td className="ds-num ds-dim">{p.min}:1</td>
                  <td className={`ds-num ${r && !r.ok ? 'ds-bad' : ''}`}>{r ? `${r.ratio.toFixed(2)}:1` : '…'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>

        <section>
          <h2>Шрифт</h2>
          <p className="ds-dim">Geologica, одна вариативная гарнитура: любой вес и ось резкости. Размеры в rem{report ? `, 1 rem здесь = ${report.rootPx} px` : ''}.</p>
          <div>{TYPE.map(([token, px]) => (
            <div className="ds-type" key={token}><code>{token} · {px}</code><span style={{ fontSize: `var(${token})`, fontWeight: 'var(--weight-strong)' }}>Разрезать 0:02,4 Split</span></div>
          ))}</div>
          <div className="ds-row">
            {(['--weight-regular', '--weight-medium', '--weight-strong', '--weight-heavy'] as const).map((w) => <span key={w} style={{ fontSize: 'var(--type-lg)', fontWeight: `var(${w})` }}>Чётко 123</span>)}
          </div>
          <div className="ds-row">
            <span style={{ fontSize: 'var(--type-xl)', fontVariationSettings: "'SHRP' var(--sharp-rest)" }}>Резко: кадр 0:42</span>
            <span style={{ fontSize: 'var(--type-xl)', fontVariationSettings: "'SHRP' var(--sharp-move)" }}>Мягко: кадр 0:42</span>
          </div>
        </section>

        <section>
          <h2>Форма</h2>
          <div className="ds-row">{RADII.map((r) => <div className="ds-box" key={r} style={{ borderRadius: `var(${r})` }}>{r.replace('--radius-', '')}</div>)}<div className="ds-touch">44</div></div>
          <div>{SPACE.map((s) => <div className="ds-type" key={s}><code>{s}</code><div className="ds-bar" style={{ width: `calc(var(${s}) * 4)` }} /></div>)}</div>
        </section>

        <section>
          <h2>Движение</h2>
          <p className="ds-dim">Нажмите строку. Любой переход прерывается касанием; при системной настройке «уменьшить движение» длительности равны нулю.</p>
          {MOTION.map(([token, what]) => (
            <button key={token} className="ds-track" data-on={played === token} style={{ border: 0, color: 'inherit', font: 'inherit', textAlign: 'right', padding: '0 var(--space-4)', cursor: 'pointer' }}
              onClick={() => setPlayed(played === token ? null : token)}>
              <span className="ds-dot" style={{ transitionDuration: `var(${token})` }} />
              {what} <code>{token}</code>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
