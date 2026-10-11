/**
 * The panel's stylesheet.
 *
 * Two rules govern everything here:
 *
 *   1. **Surfaces and text come from the shell's theme tokens**
 *      (`--dsw-alias-*`), so the panel follows the user's light/dark preference
 *      automatically — the shell defines those tokens on `body` and redefines
 *      them under `body[data-ds-dark-theme]`.
 *   2. **The activity ramp does not.** The five-step purple scale below is
 *      sampled pixel-for-pixel from the reference panel, because it is that
 *      panel's visual signature rather than a themed surface. A separate light
 *      variant keeps the same hue legible instead of washing out.
 *
 * @module dsh-token-dashboard/client/styles
 */

/** Identifier used for the injected `<style>` element. */
export const STYLE_ID = 'dsh-token-dashboard/panel'

/**
 * The activity heatmap's five steps.
 *
 * Index 0 is "no activity"; 1-4 are the ramp. The purple comes from the
 * reference panel — see the `Less ▢▢▢▢▢ More` swatch and the filled cells in
 * `research/codex-usage-panel.md`; `tools/sample-shot.mjs` measures a PNG's
 * colours so a swatch can be checked rather than eyeballed.
 *
 * **Darker means more, in both themes.** Level 1 is the faintest step and level
 * 4 is the deepest, fullest purple, so a heavy day is the one that stands out.
 * On the light theme that is simply a ramp getting darker; on the dark theme it
 * runs from a pale lavender down to a saturated deep purple. This is a
 * deliberate departure from the reference, which brightened the dark theme
 * instead — brighter-for-more reads backwards next to every other quota meter.
 *
 * The empty step is also deliberate: the reference sits it on `#181818`, which
 * is nearly invisible on DSH's own dark surface, so step 0 uses the theme's
 * nested-surface colour and stays quiet in either theme.
 */
export const HEATMAP_RAMP = {
  // Pale → deep. Step 4 is the darkest, so the heaviest day is the heaviest cell.
  light: ['#ebebed', '#ddd0fb', '#b98ef7', '#8b46f0', '#5f21c9'],
  dark: ['#232326', '#ddd0fb', '#b98ef7', '#8b46f0', '#5f21c9'],
} as const

/**
 * Gap between two heatmap columns, in pixels.
 *
 * Declared once because the cells, the month axis and the grid's own width
 * formula all have to agree on it: the formula converts a maximum cell size
 * into a maximum grid width, and a mismatch of one gap per column would put the
 * axis back out of step with the cells it labels.
 */
export const HEATMAP_GAP = 4

/**
 * The largest a heatmap cell is allowed to grow, in pixels.
 *
 * Without a ceiling a 1600px window stretches a cell to 44px and the graph
 * stops reading as a contribution grid. The grid fills the panel up to this
 * cell size and then stops, so the panel width — not a hard-coded grid width —
 * is what decides the layout. It is wide enough that a 1200px settings dialog
 * never reaches it; it only bites on a window wider than roughly 1500px.
 */
export const HEATMAP_MAX_CELL = 38

/** The panel stylesheet. */
export const PANEL_CSS = [
  '.tdd{',
  `--tdd-ramp-0:${HEATMAP_RAMP.light[0]};--tdd-ramp-1:${HEATMAP_RAMP.light[1]};`,
  `--tdd-ramp-2:${HEATMAP_RAMP.light[2]};--tdd-ramp-3:${HEATMAP_RAMP.light[3]};--tdd-ramp-4:${HEATMAP_RAMP.light[4]};`,
  // `--tdd-heat-columns` is overwritten per render from the grid the panel
  // actually built; the value here is only a fallback for a grid rendered
  // without that style attribute.
  `--tdd-heat-gap:${HEATMAP_GAP}px;--tdd-heat-cell:${HEATMAP_MAX_CELL}px;--tdd-heat-columns:27;`,
  // The panel is NOT a scroll container. The settings dialog already scrolls its
  // body, so a `height:100%` plus `overflow-y:auto` here produced a SECOND
  // scrollbar inside the dialog's own — measured at a 1000px window: this
  // element scrolled 1123px of content inside an 864px box while the dialog
  // scrolled the same page. It now grows to its natural height and leaves
  // scrolling to its host.
  'display:flex;flex-direction:column;gap:26px;min-width:0;',
  // Deliberately NO `overflow` here at all, in either axis. CSS coerces a
  // computed `overflow-y:visible` to `auto` as soon as the other axis is not
  // `visible`, so an `overflow-x:hidden` added later as a clipping guard would
  // silently bring the second scrollbar straight back. Measured: with
  // `overflow-x:hidden` this rule computed to `overflow-y:auto` and scrolled
  // 1087px of content inside an 830px box.
  'padding:4px 2px 32px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  // A non-scrolling flex column still shrinks its children once the content is
  // taller than the viewport, and several sections clip their overflow — so
  // they would be squashed instead of pushing the dialog's scrollbar. Measured
  // before this rule: the five-number bar collapsed to its 2px of borders and
  // every figure vanished.
  '.tdd>*{flex:0 0 auto}',
  'body[data-ds-dark-theme] .tdd{',
  `--tdd-ramp-0:${HEATMAP_RAMP.dark[0]};--tdd-ramp-1:${HEATMAP_RAMP.dark[1]};`,
  `--tdd-ramp-2:${HEATMAP_RAMP.dark[2]};--tdd-ramp-3:${HEATMAP_RAMP.dark[3]};--tdd-ramp-4:${HEATMAP_RAMP.dark[4]}}`,

  // header
  '.tdd-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}',
  '.tdd-title{margin:0;font-size:14px;font-weight:600}',
  '.tdd-stamp{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.tdd-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;',
  'color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;padding:3px 10px}',
  '.tdd-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
  '.tdd-btn:disabled{cursor:default;opacity:.5}',

  // identity
  '.tdd-identity{display:flex;flex-direction:column;align-items:center;gap:10px;padding:22px 0 4px;text-align:center}',
  '.tdd-avatar{width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:none}',
  '.tdd-avatar-fallback{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);',
  'font-size:30px;font-weight:600}',
  '.tdd-name{font-size:22px;font-weight:600;letter-spacing:-.01em}',
  '.tdd-handle{color:var(--dsw-alias-label-secondary);font-size:13px}',

  // the five-number bar
  '.tdd-stats{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);',
  'border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}',
  '.tdd-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
  'padding:20px 10px;text-align:center;min-width:0}',
  '.tdd-stat+.tdd-stat{border-left:1px solid var(--dsw-alias-border-l1)}',
  '.tdd-stat-value{font-size:19px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.tdd-stat-label{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',

  // sections
  '.tdd-section{display:flex;flex-direction:column;gap:12px;min-width:0}',
  '.tdd-section-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}',
  '.tdd-section-title{font-size:14px;font-weight:600}',
  '.tdd-tabs{display:inline-flex;gap:4px;align-items:center}',
  '.tdd-tab{appearance:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);',
  'cursor:pointer;font:inherit;font-size:12px;padding:2px 7px}',
  '.tdd-tab:hover{color:var(--dsw-alias-label-primary)}',
  ".tdd-tab[aria-pressed='true']{color:var(--dsw-alias-label-primary);font-weight:600}",

  // heatmap
  // The year is drawn as two stacked six-month blocks, not one long row. A
  // single row needs 53 columns, which at a readable cell size is wider than
  // the settings panel and becomes a horizontal scrollbar; halving it gives each
  // block ~26 columns, so the cells stay legible and a whole year fits without
  // scrolling at any panel width.
  //
  // GEOMETRY IS DERIVED, NOT HARD-CODED. Three elements have to agree on it: the
  // cell grid, the month axis, and the axis's idea of where column `i` starts.
  // They therefore share one rule — same track count, same gap — and one width
  // formula. The formula reads the column count off `--tdd-heat-columns`, which
  // the panel sets from the grid it actually built, so a 52-week year and a
  // 53-week year both size correctly and nothing has to be kept in sync by hand.
  //
  // `min(100%, …)` is what makes this responsive: on a panel narrower than the
  // formula asks for, the grids take the full panel width and the fluid tracks
  // shrink with it; on a wider one they stop at `--tdd-heat-cell` so the cells
  // never balloon. No `max-width`, because a second ceiling is exactly how the
  // grid and the rest of the panel drifted apart in the first place — the grid
  // stopped at 660px while the five-number bar and the footer kept going to the
  // panel's edge.
  '.tdd-heat{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.tdd-heat-blocks{display:flex;flex-direction:column;gap:16px;min-width:0}',
  '.tdd-heat-block{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.tdd-heat-grid,.tdd-heat-months{',
  'display:grid;grid-template-columns:repeat(var(--tdd-heat-columns),minmax(0,1fr));',
  'gap:var(--tdd-heat-gap);',
  'width:min(100%,calc(var(--tdd-heat-columns)*(var(--tdd-heat-cell) + var(--tdd-heat-gap)) - var(--tdd-heat-gap)))}',
  // Cells arrive column-major (a week's seven days in a row), so the grid has to
  // fill down its seven rows first and only then move to the next column. The
  // month axis below has one row and needs no flow, which is why it is not in
  // this rule.
  '.tdd-heat-grid{grid-template-rows:repeat(7,minmax(0,1fr));grid-auto-flow:column}',
  '.tdd-cell{width:100%;aspect-ratio:1;border-radius:3px;background:var(--tdd-ramp-0)}',
  ".tdd-cell[data-level='1']{background:var(--tdd-ramp-1)}",
  ".tdd-cell[data-level='2']{background:var(--tdd-ramp-2)}",
  ".tdd-cell[data-level='3']{background:var(--tdd-ramp-3)}",
  ".tdd-cell[data-level='4']{background:var(--tdd-ramp-4)}",
  // A padded cell is only there to keep the two blocks on one column count; it
  // must hold its track without drawing anything.
  ".tdd-cell[data-trailing='true']{visibility:hidden}",
  '.tdd-heat-months{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}',
  // A month name is wider than its column, so it spills right across the empty
  // columns that follow — which is exactly where it should sit. `justify-self`
  // pins it to the LEFT edge of its own track: left to itself the span would be
  // sized to its text and centred in the track, so a label wider than its column
  // would start early and read as belonging to the previous month.
  '.tdd-heat-month{justify-self:start;white-space:nowrap;overflow:visible}',
  '.tdd-heat-foot{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;',
  'color:var(--dsw-alias-label-secondary);font-size:11px;min-height:18px}',
  '.tdd-heat-legend{display:inline-flex;align-items:center;gap:5px}',
  '.tdd-heat-legend .tdd-cell{width:11px;flex:none}',

  // insights
  '.tdd-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 44px}',
  '@media (max-width:640px){.tdd-cols{grid-template-columns:minmax(0,1fr)}}',
  '.tdd-col{display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.tdd-col-title{font-size:13px;font-weight:600}',
  '.tdd-rows{display:flex;flex-direction:column;gap:9px;min-width:0}',
  '.tdd-row{display:grid;grid-template-columns:minmax(max-content,1fr) max-content;gap:6px 14px;align-items:baseline;min-width:0}',
  '.tdd-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tdd-row-value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',

  // states
  '.tdd-empty{color:var(--dsw-alias-label-secondary);padding:6px 0}',
  '.tdd-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:14px 16px}',
  '.tdd-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600;margin-bottom:4px}',
  '.tdd-sub{color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.tdd-warn{border-left:2px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-secondary);',
  'font-size:11px;padding:2px 0 2px 10px}',
  '.tdd-skeleton{color:var(--dsw-alias-label-secondary);padding:40px 0;text-align:center}',
].join('')
