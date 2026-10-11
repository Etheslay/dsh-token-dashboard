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
 * Index 0 is "no activity"; 1-4 are the ramp. These are GitHub's contribution
 * colours, read out of a swatch of the real thing with `tools/sample-shot.mjs`
 * (`#033a16` `#196c2e` `#2ea043` `#56d364` on `#151b23`). The light row is
 * GitHub's light palette for the same graph.
 */
export const HEATMAP_RAMP = {
  light: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
  dark: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'],
} as const

/** The panel stylesheet. */
export const PANEL_CSS = [
  '.tdd{',
  `--tdd-ramp-0:${HEATMAP_RAMP.light[0]};--tdd-ramp-1:${HEATMAP_RAMP.light[1]};`,
  `--tdd-ramp-2:${HEATMAP_RAMP.light[2]};--tdd-ramp-3:${HEATMAP_RAMP.light[3]};--tdd-ramp-4:${HEATMAP_RAMP.light[4]};`,
  'display:flex;flex-direction:column;gap:26px;min-width:0;height:100%;overflow-y:auto;',
  'padding:4px 2px 32px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  // `.tdd` is a scroll container, so its children are flex items that would
  // otherwise SHRINK once the content grew taller than the viewport — and
  // because several of them clip their overflow, shrinking squashes them to
  // nothing instead of producing a scrollbar. Two stacked heatmap blocks made
  // the panel tall enough to hit this on a short window: the five-number bar
  // collapsed to its 2px of borders and every figure vanished.
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
  // The cells and the month axis are separate grids, so every one of them MUST
  // declare identical column geometry or the labels drift out from under their
  // columns. They share one rule below for exactly that reason.
  '.tdd-heat{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.tdd-heat-blocks{display:flex;flex-direction:column;gap:16px;min-width:0}',
  '.tdd-heat-block{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.tdd-heat-grid,.tdd-heat-months{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);',
  'gap:4px;width:100%;max-width:660px}',
  '.tdd-heat-grid{grid-template-rows:repeat(7,minmax(0,1fr))}',
  '.tdd-cell{width:100%;aspect-ratio:1;border-radius:3px;background:var(--tdd-ramp-0)}',
  ".tdd-cell[data-level='1']{background:var(--tdd-ramp-1)}",
  ".tdd-cell[data-level='2']{background:var(--tdd-ramp-2)}",
  ".tdd-cell[data-level='3']{background:var(--tdd-ramp-3)}",
  ".tdd-cell[data-level='4']{background:var(--tdd-ramp-4)}",
  '.tdd-heat-months{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}',
  // A month name is wider than its column, so it spills right across the empty
  // columns that follow — which is exactly where it should sit.
  '.tdd-heat-month{white-space:nowrap;overflow:visible}',
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
