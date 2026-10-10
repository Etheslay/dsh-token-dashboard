/**
 * The panel's stylesheet.
 *
 * Two rules govern everything here:
 *
 *   1. **Colour comes from the shell's theme tokens** (`--dsw-alias-*`), never
 *      from a hard-coded palette, so the panel follows the user's light/dark
 *      preference automatically — the shell defines those tokens on `body` and
 *      redefines them under `body[data-ds-dark-theme]`.
 *   2. **The only Codex-specific colours are the accent pair**, and they are
 *      switched on that same `body[data-ds-dark-theme]` attribute rather than
 *      on `prefers-color-scheme`, so a user who forces light on a dark OS still
 *      gets the light accent.
 *
 * The label/value grid is the Codex `/status` card's layout algebra expressed
 * in CSS: `grid-template-columns: max-content 1fr` is exactly Codex's
 * "recompute the label column from the labels actually present, then put every
 * value at the same offset".
 *
 * @module dsh-token-dashboard/client/styles
 */

/** Identifier used for the injected `<style>` element. */
export const STYLE_ID = 'dsh-token-dashboard/panel'

/** Codex's dark-mode accent (`style.rs`). */
const ACCENT_DARK = '#63a8f8'
/** Codex's light-mode accent (`style.rs`). */
const ACCENT_LIGHT = '#1c64c8'

/** The panel stylesheet. */
export const PANEL_CSS = `
.tdd {
  --tdd-accent: ${ACCENT_LIGHT};
  --tdd-accent-soft: color-mix(in srgb, ${ACCENT_LIGHT} 14%, transparent);
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 4px 2px 32px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
body[data-ds-dark-theme] .tdd {
  --tdd-accent: ${ACCENT_DARK};
  --tdd-accent-soft: color-mix(in srgb, ${ACCENT_DARK} 18%, transparent);
}

/* ---------- header ---------- */
.tdd-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}
.tdd-headtext { min-width: 0; }
.tdd-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.tdd-sub {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.tdd-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.tdd-ranges {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.tdd-range {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
}
.tdd-range:hover { color: var(--dsw-alias-label-primary); }
.tdd-range[aria-pressed='true'] {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.tdd-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
}
.tdd-btn:hover { border-color: var(--dsw-alias-border-l2); }
.tdd-btn:disabled { cursor: default; opacity: 0.55; }
.tdd-stamp {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- the Codex label/value card ---------- */
.tdd-card {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 2ch;
  row-gap: 3px;
  min-width: 0;
}
.tdd-block { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.tdd-label {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.tdd-label::after { content: ':'; }
.tdd-value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.tdd-dim { color: var(--dsw-alias-label-secondary); }
.tdd-accent { color: var(--tdd-accent); }
.tdd-mono {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: -0.02em;
}
.tdd-gap { grid-column: 1 / -1; height: 8px; }

/* ---------- big numbers (Codex analytics Overview) ---------- */
.tdd-figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: 14px 20px;
  padding: 2px 0;
}
.tdd-figure { min-width: 0; }
.tdd-figure-value {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tdd-figure-label {
  margin-top: 1px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
}

/* ---------- activity chart ---------- */
.tdd-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tdd-section-title { font-size: 13px; font-weight: 600; }
.tdd-section-note { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.tdd-chart { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tdd-chart-row {
  display: flex;
  gap: 1px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 15px;
  line-height: 1.1;
  min-width: 0;
}
.tdd-bar {
  appearance: none;
  border: 0;
  background: transparent;
  border-radius: 2px;
  color: var(--tdd-accent);
  cursor: default;
  flex: 1 1 0;
  font: inherit;
  min-width: 3px;
  padding: 0;
  text-align: center;
}
.tdd-bar:hover, .tdd-bar[data-active='true'] { background: var(--tdd-accent-soft); }
.tdd-axis {
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  white-space: nowrap;
  font-size: 11px;
}
/* One baseline cell per bar column, so the rule ends where the data does. */
.tdd-baseline { font-size: 11px; line-height: 1; }
.tdd-baseline .tdd-axis { flex: 1 1 0; min-width: 3px; text-align: center; }
.tdd-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.tdd-callout {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.tdd-callout strong { font-weight: 600; }

/* ---------- breakdown lists ---------- */
.tdd-legend-list { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tdd-legend-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.tdd-legend-name {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}
.tdd-legend-name > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tdd-dot { color: var(--tdd-accent); flex: none; font-size: 9px; line-height: 1; }
.tdd-legend-pct {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tdd-legend-sub {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* ---------- session table ---------- */
.tdd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tdd-table th {
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
  padding: 0 10px 5px 0;
  text-align: left;
  white-space: nowrap;
}
.tdd-table td {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding: 6px 10px 6px 0;
  vertical-align: top;
}
.tdd-table th:last-child, .tdd-table td:last-child { padding-right: 0; text-align: right; }
.tdd-table .tdd-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.tdd-session-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tdd-session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 34ch;
}
.tdd-tag {
  border: 1px solid var(--tdd-accent);
  border-radius: 4px;
  color: var(--tdd-accent);
  flex: none;
  font-size: 10px;
  line-height: 1.4;
  padding: 0 4px;
}
.tdd-path {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 34ch;
}

/* ---------- states ---------- */
.tdd-empty {
  color: var(--dsw-alias-label-secondary);
  padding: 10px 0;
}
.tdd-error {
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  padding: 12px 14px;
}
.tdd-error-title { color: var(--dsw-alias-state-error-primary); font-weight: 600; }
.tdd-warn {
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  padding: 2px 0 2px 10px;
}
.tdd-skeleton { color: var(--dsw-alias-label-secondary); padding: 18px 0; }
`
