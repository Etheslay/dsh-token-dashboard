/**
 * Presentation primitives copied from OpenAI Codex.
 *
 * Every function mirrors a specific Rust function so the panel renders numbers
 * exactly the way Codex does. The originals live in the open-source
 * `openai/codex` repository:
 *
 *   - `formatTokensCompact`  ← `tui/src/status/helpers.rs`          (status card)
 *   - `compactAmount`        ← `tui/src/analytics/data.rs`          (analytics headline)
 *   - `formatWithSeparators` ← `protocol/src/num_format.rs`
 *   - `countValue`           ← `tui/src/analytics/summary_panel.rs`
 *   - `formatDuration`       ← `tui/src/analytics/summary_panel.rs`
 *   - `renderLimitProgressBar` ← `tui/src/status/rate_limits.rs`
 *   - `percentRemaining`     ← `tui/src/token_usage.rs`
 *   - `formatResetTimestamp` ← `tui/src/status/helpers.rs`
 *
 * The Rust source is quoted in each doc comment so a future Codex change can be
 * diffed against this file instead of guessed at.
 *
 * @module dsh-token-dashboard/format
 */

/** Codex's `STATUS_LIMIT_BAR_SEGMENTS`. */
export const LIMIT_BAR_SEGMENTS = 20
/** Codex's `STATUS_LIMIT_BAR_FILLED`. */
export const LIMIT_BAR_FILLED = '\u2588'
/** Codex's `STATUS_LIMIT_BAR_EMPTY`. */
export const LIMIT_BAR_EMPTY = '\u2591'
/** Codex's `BarPlot` glyph ramp, index 0-8 (`analytics/plot/painting.rs`). */
export const BAR_RAMP = [' ', '\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'] as const
/** The em dash Codex renders for a missing value. */
export const MISSING = '\u2014'

/**
 * Codex's `BASELINE_TOKENS`, subtracted from both sides of the occupancy ratio.
 *
 * Deliberately NOT applied by default here. Codex subtracts a fixed 12K to
 * discount its own system prompt and tool schemas; DSH's prompt overhead is a
 * different size, so copying the constant would make the percentage wrong
 * rather than compatible. It stays exposed so a deployment can opt in.
 */
export const CODEX_BASELINE_TOKENS = 12_000

/**
 * Render a finite number with exactly `decimals` places, rounding half to even.
 *
 * This exists because Rust's `format!("{:.N}")` and JavaScript's
 * `Number.prototype.toFixed` disagree on an exact tie: Rust rounds half to
 * even, JavaScript's spec picks the larger n. `128.5` with no decimals is
 * therefore `128` in Rust and `129` in JavaScript.
 *
 * That case is not hypothetical here — `format_tokens_compact` divides by 1000
 * and uses zero decimals above 100, so any token count ending in `500` inside
 * `100_000..1_000_000` lands exactly on a half. Reimplementing the rounding is
 * the difference between a port and a lookalike.
 * @param value - The value to render; finite.
 * @param decimals - Number of fractional digits, `0` or more.
 * @returns The fixed-point string.
 */
function fixedHalfEven(value: number, decimals: number): string {
  const factor = 10 ** decimals
  const scaled = value * factor
  const lower = Math.floor(scaled)
  const diff = scaled - lower
  let n: number
  if (diff > 0.5) n = lower + 1
  else if (diff < 0.5) n = lower
  else n = lower % 2 === 0 ? lower : lower + 1

  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(n).toString().padStart(decimals + 1, '0')
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

/**
 * Codex `format_tokens_compact`: K/M/B/T with 2/1/0 decimals and trailing zeros
 * stripped.
 *
 * ```rust
 * if value == 0 { return "0".to_string(); }
 * if value < 1_000 { return value.to_string(); }
 * let (scaled, suffix) = if value >= 1_000_000_000_000 { (v / 1e12, "T") }
 *     else if value >= 1_000_000_000 { (v / 1e9, "B") }
 *     else if value >= 1_000_000 { (v / 1e6, "M") }
 *     else { (v / 1e3, "K") };
 * let decimals = if scaled < 10.0 { 2 } else if scaled < 100.0 { 1 } else { 0 };
 * ```
 * @param value - Raw token count; negatives clamp to zero like `value.max(0)`.
 * @returns The compact label, for example `999`, `12.35K`, `128K`, `1.2M`.
 */
export function formatTokensCompact(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  if (safe === 0) return '0'
  if (safe < 1_000) return String(safe)

  let scaled: number
  let suffix: string
  if (safe >= 1_000_000_000_000) {
    scaled = safe / 1_000_000_000_000
    suffix = 'T'
  } else if (safe >= 1_000_000_000) {
    scaled = safe / 1_000_000_000
    suffix = 'B'
  } else if (safe >= 1_000_000) {
    scaled = safe / 1_000_000
    suffix = 'M'
  } else {
    scaled = safe / 1_000
    suffix = 'K'
  }

  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0
  return stripTrailingZeros(fixedHalfEven(scaled, decimals)) + suffix
}

/**
 * Codex `compact_amount` from the analytics headline: always ONE decimal, and
 * it promotes the unit before rounding could print `1000K`.
 *
 * ```rust
 * while scaled.abs() >= 999.95 && unit + 1 < units.len() { scaled /= 1_000.0; unit += 1; }
 * let rounded = format!("{:.1}", (scaled * 10.0).round() / 10.0);
 * ```
 * @param value - The headline figure.
 * @returns The compact label, for example `142.3B`, `7B`.
 */
export function compactAmount(value: number): string {
  if (!Number.isFinite(value)) return MISSING
  if (Math.abs(value) < 1_000) return String(Math.trunc(value))
  const units = ['K', 'M', 'B', 'T']
  let scaled = value / 1_000
  let unit = 0
  while (Math.abs(scaled) >= 999.95 && unit + 1 < units.length) {
    scaled /= 1_000
    unit++
  }
  // `f64::round` is half away from zero; `Math.round` agrees for the positive
  // values a token count can take.
  return stripTrailingZeros(fixedHalfEven(Math.round(scaled * 10) / 10, 1)) + units[unit]
}

/** Strip trailing zeros and a trailing dot, mirroring Rust's manual trim. */
function stripTrailingZeros(formatted: string): string {
  if (!formatted.includes('.')) return formatted
  let out = formatted
  while (out.endsWith('0')) out = out.slice(0, -1)
  if (out.endsWith('.')) out = out.slice(0, -1)
  return out
}

/**
 * Codex `format_with_separators`: locale-aware grouping, `12345` → `12,345`.
 *
 * Codex resolves one formatter from the system locale and falls back to
 * `en-US`; passing the locale in keeps this pure and lets the panel follow the
 * DSH UI language rather than the OS.
 * @param value - Integer to group.
 * @param locale - BCP-47 tag, or `undefined` for the runtime default.
 * @returns The grouped integer.
 */
export function formatWithSeparators(value: number, locale?: string): string {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0
  try {
    return safe.toLocaleString(locale)
  } catch {
    return safe.toLocaleString('en-US')
  }
}

/**
 * Codex `count_value`: manual thousands grouping with `—` for a missing value.
 * @param value - Count, or `undefined` to render the missing placeholder.
 * @returns The grouped count or `—`.
 */
export function countValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return MISSING
  const digits = String(Math.trunc(value))
  let out = ''
  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ','
    out += digits[index]
  }
  return out
}

/**
 * Codex `duration(seconds)`.
 *
 * ```rust
 * match (hours, minutes) {
 *     (0, 0) => format!("{seconds}s"),
 *     (0, minutes) => format!("{minutes}m"),
 *     (hours, 0) => format!("{hours}h"),
 *     (hours, minutes) => format!("{hours}h {minutes}m"),
 * }
 * ```
 * @param seconds - Non-negative duration; negatives clamp to zero.
 * @returns The duration label, for example `44h 7m`.
 */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours === 0 && minutes === 0) return `${safe}s`
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Whether a locale tag renders numbers and durations in Chinese units. */
function isChinese(locale: string | undefined): boolean {
  return typeof locale === 'string' && /^zh/i.test(locale)
}

/**
 * A duration in the units the active locale actually reads.
 *
 * Codex only ever renders for English, so `formatDuration` alone would print
 * `46m 59s` where a Chinese UI expects `46分59秒`. Seconds are dropped once an
 * hour is on the clock, which is what the reference panel does.
 * @param seconds - Non-negative duration; negatives clamp to zero.
 * @param locale - BCP-47 tag of the active UI language.
 * @returns The localized duration label.
 */
export function localeDuration(seconds: number, locale?: string): string {
  if (!isChinese(locale)) return formatDuration(seconds)
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  if (hours > 0) return `${hours}\u5c0f\u65f6${minutes}\u5206`
  if (minutes > 0) return `${minutes}\u5206${rest}\u79d2`
  return `${rest}\u79d2`
}

/**
 * A token count in the units the active locale actually reads.
 *
 * The reference panel renders Chinese counts as 万 / 亿 rather than K / M, one
 * decimal either way: `370_000_000` reads `3.7亿` and `53_171_000` reads
 * `5317.1万`. English keeps Codex's own `compactAmount` rule.
 *
 * Rounding must not print a unit it has outgrown: `99_999_999 / 10_000` rounds
 * to `10000`, and `10000万` is a worse label than the `1亿` the same value has.
 * The 万 arm therefore re-checks its own rounded magnitude and promotes.
 * @param value - The count.
 * @param locale - BCP-47 tag of the active UI language.
 * @returns The localized compact label.
 */
export function localeCompact(value: number, locale?: string): string {
  if (!isChinese(locale)) return compactAmount(value)
  if (!Number.isFinite(value)) return MISSING
  const safe = Math.max(0, Math.trunc(value))
  if (safe < 10_000) return String(safe)
  const oneDecimal = (divisor: number): string => stripTrailingZeros(fixedHalfEven(safe / divisor, 1))
  if (safe >= 100_000_000) return `${oneDecimal(100_000_000)}\u4ebf`
  const wan = oneDecimal(10_000)
  // `Number("10000")` is 10000, `Number("5317.1")` is 5317.1 — trailing zeros
  // are already stripped, so the parsed string is the rounded magnitude.
  return Number(wan) >= 10_000 ? `${oneDecimal(100_000_000)}\u4ebf` : `${wan}\u4e07`
}

/**
 * A plain grouped count that also follows the Chinese convention.
 * @param value - Count, or `undefined` for the missing placeholder.
 * @param locale - BCP-47 tag of the active UI language.
 * @returns The grouped count or `—`.
 */
export function localeCount(value: number | undefined, locale?: string): string {
  if (value === undefined || !Number.isFinite(value)) return MISSING
  return isChinese(locale) ? localeCompact(value, locale) : countValue(value)
}

/**
 * Codex `render_limit_progress_bar`: a fixed-width `[███░░░]` bar.
 *
 * ```rust
 * let ratio = (percent_remaining / 100.0).clamp(0.0, 1.0);
 * let filled = (ratio * segments as f64).round() as usize;
 * ```
 * The argument is the REMAINING percentage: a low value yields a short bar,
 * matching Codex. Passing a used percentage inverts the bar.
 * @param percentRemaining - Remaining share in `0..=100`; clamped.
 * @param segments - Bar width in cells; defaults to Codex's 20.
 * @returns The bracketed bar, using Codex's block glyphs.
 */
export function renderLimitProgressBar(percentRemaining: number, segments: number = LIMIT_BAR_SEGMENTS): string {
  const width = Math.max(0, Math.trunc(segments))
  const ratio = Math.min(1, Math.max(0, (Number.isFinite(percentRemaining) ? percentRemaining : 0) / 100))
  const filled = Math.min(width, Math.round(ratio * width))
  return '[' + LIMIT_BAR_FILLED.repeat(filled) + LIMIT_BAR_EMPTY.repeat(width - filled) + ']'
}

/**
 * Codex `format_status_limit_summary`: `"{percent:.0}% left"`.
 * @param percentRemaining - Remaining share; rounded to 0 decimals.
 * @returns The summary label.
 */
export function formatLimitSummary(percentRemaining: number): string {
  const safe = Number.isFinite(percentRemaining) ? percentRemaining : 0
  return `${safe.toFixed(0)}% left`
}

/** Options for {@link percentOfContextWindowRemaining}. */
export interface ContextOccupancyOptions {
  /**
   * Tokens discounted from both sides before the ratio, mirroring Codex's
   * `BASELINE_TOKENS`. Defaults to `0` — see {@link CODEX_BASELINE_TOKENS}.
   */
  baselineTokens?: number
}

/**
 * Codex `TokenUsage::percent_of_context_window_remaining`, with the baseline
 * made explicit instead of hard-coded.
 *
 * ```rust
 * if context_window <= BASELINE_TOKENS { return 0; }
 * let effective_window = context_window - BASELINE_TOKENS;
 * let used = (self.tokens_in_context_window() - BASELINE_TOKENS).max(0);
 * let remaining = (effective_window - used).max(0);
 * ((remaining as f64 / effective_window as f64) * 100.0).clamp(0.0, 100.0).round() as i64
 * ```
 * @param tokensInContext - Prompt size of the request under measurement.
 * @param contextWindow - Model context capacity.
 * @param options - Baseline override; see {@link ContextOccupancyOptions}.
 * @returns Remaining percentage in `0..=100`.
 */
export function percentOfContextWindowRemaining(
  tokensInContext: number,
  contextWindow: number,
  options: ContextOccupancyOptions = {},
): number {
  const baseline = Math.max(0, options.baselineTokens ?? 0)
  if (!Number.isFinite(contextWindow) || contextWindow <= baseline) return 0
  const effectiveWindow = contextWindow - baseline
  const used = Math.max(0, (Number.isFinite(tokensInContext) ? tokensInContext : 0) - baseline)
  const remaining = Math.max(0, effectiveWindow - used)
  return Math.round(Math.min(1, Math.max(0, remaining / effectiveWindow)) * 100)
}

/**
 * The context-window value string from Codex's `context_window_spans`:
 * `"{percent}% left ({used} used / {window})"`.
 * @param tokensInContext - Prompt size of the request under measurement.
 * @param contextWindow - Model context capacity.
 * @param options - Baseline override; see {@link ContextOccupancyOptions}.
 * @returns The formatted value.
 */
export function formatContextWindow(
  tokensInContext: number,
  contextWindow: number,
  options: ContextOccupancyOptions = {},
): string {
  const percent = percentOfContextWindowRemaining(tokensInContext, contextWindow, options)
  return `${percent}% left (${formatTokensCompact(tokensInContext)} used / ${formatTokensCompact(contextWindow)})`
}

/**
 * Codex `format_reset_timestamp`, reused for the freshness stamp.
 *
 * ```rust
 * let time = dt.format(clock_format.time_format());
 * if dt.date_naive() == captured_at.date_naive() { time }
 * else { format!("{time} on {}", dt.format("%-d %b")) }
 * ```
 * Reset times are ALWAYS absolute clock times — there is no relative countdown
 * anywhere in Codex's status card, so this panel does not invent one.
 * @param instant - The moment to render.
 * @param reference - The moment "today" is measured against.
 * @param locale - BCP-47 tag used for the time format.
 * @returns `09:25` for today, otherwise `09:25 on 7 May`.
 */
export function formatAbsoluteTime(instant: Date, reference: Date, locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(instant)
  const sameDay =
    instant.getFullYear() === reference.getFullYear() &&
    instant.getMonth() === reference.getMonth() &&
    instant.getDate() === reference.getDate()
  if (sameDay) return time
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(instant)
  return `${time} on ${day}`
}

/**
 * Codex `ratio_percent`: `{value:.0}%`, or the em dash when absent.
 * @param value - Percentage, or `undefined`.
 * @returns The formatted percentage or `—`.
 */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return MISSING
  return `${value.toFixed(0)}%`
}

/**
 * Map a value onto Codex's 8-step bar-chart ramp.
 * @param value - The datum.
 * @param max - The series maximum; a non-positive max yields the lowest glyph.
 * @returns One glyph from {@link BAR_RAMP}.
 */
export function barGlyph(value: number, max: number): string {
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(value) || value <= 0) return BAR_RAMP[0]
  const ratio = Math.min(1, value / max)
  const index = Math.max(1, Math.min(BAR_RAMP.length - 1, Math.ceil(ratio * (BAR_RAMP.length - 1))))
  return BAR_RAMP[index]!
}
