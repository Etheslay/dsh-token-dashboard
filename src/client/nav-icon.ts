/**
 * The nav glyph for the Usage section.
 *
 * `settings.section` projects only `id` / `order` / `label`, so a third-party
 * section has no icon to pass and the shell falls back to its own gear. The
 * fix, used by dsh-market and dsh-better-sidebar as well, is to claim the one
 * nav row whose visible text equals this plugin's own label and paint the mark
 * with a CSS mask.
 *
 * Scope is deliberately narrow: only the matching row is touched, the marker
 * and the stylesheet live inside one `ctx.effect` so they leave with the fiber,
 * and a MutationObserver re-claims the row after a locale switch so the label
 * and the glyph can never disagree.
 *
 * @module dsh-token-dashboard/client/nav-icon
 */

/** Attribute marking the one nav row this plugin owns. */
export const NAV_ICON_MARKER = 'data-dsh-token-dashboard-nav-icon'

/**
 * The settings dialog's nav rows. The shell renders each `settings.section`
 * entry as a `<button>` inside the panel's `<nav>`.
 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** Glyph box in px, matching the size the shell renders every nav icon at. */
export const NAV_ICON_SIZE = 16

/**
 * A bar-chart mark, echoing the panel's own activity chart.
 *
 * Painted pure black on purpose: a CSS mask reads alpha only, and the visible
 * colour comes from the element's `background-color: currentColor`.
 * @returns The mark as standalone SVG.
 */
export function markSvg(): string {
  const bars: Array<[number, number, number]> = [
    [1, 9, 6],
    [6, 5, 10],
    [11, 1, 14],
  ]
  const rects = bars
    .map(([x, y, height]) => `<rect x="${x}" y="${y}" width="4" height="${height}" rx="1.4"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#000"><g>${rects}</g></svg>`
}

/**
 * The mask URL for the mark, percent-encoded at runtime so no hand-escaping is
 * involved.
 * @param svg - The mark source; defaults to {@link markSvg}.
 * @returns A `data:` URL usable as a CSS `mask-image`.
 */
export function markUrl(svg: string = markSvg()): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Whether a nav row is this plugin's own.
 *
 * Pure, and the only decision this feature makes: the row whose visible text is
 * the label the shell is currently projecting. An empty label matches nothing,
 * so a locale that has not resolved yet cannot mark the whole nav.
 * @param rowText - The row's text content.
 * @param wantedLabel - This plugin's current label.
 * @returns `true` when the row belongs to this plugin.
 */
export function isOwnNavRow(rowText: string | null | undefined, wantedLabel: string | null | undefined): boolean {
  const wanted = String(wantedLabel ?? '').trim()
  if (wanted.length === 0) return false
  return String(rowText ?? '').trim() === wanted
}

/**
 * Stylesheet for the marked row: hide the shell's gear and draw the mark.
 * @param maskUrl - The mask URL from {@link markUrl}.
 * @returns The CSS text.
 */
export function navIconCss(maskUrl: string): string {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
  ].join('\n')
}

/** The slice of the client context this feature needs. */
export interface NavIconContext {
  effect(callback: () => unknown, label?: string): void
}

/**
 * Install the nav glyph.
 * @param ctx - Client context, for effect ownership.
 * @param resolveLabel - This plugin's current section label, re-read on every
 *   sync so a locale switch is picked up without re-registering.
 */
export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-token-dashboard'
    tag.dataset.pluginCss = 'dsh-token-dashboard/settings-nav-icon'
    tag.textContent = navIconCss(markUrl())
    document.head.appendChild(tag)

    let disposed = false
    let scheduled = false

    const sync = (): void => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel()
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }

    // Coalesce a burst of DOM mutations into one sync, landing before the next
    // paint so the row never shows the gear first.
    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()

    // A DOM without MutationObserver (a test harness, an exotic shell) still
    // gets the mark for the rows present at mount; it just cannot re-claim them
    // after a locale switch.
    const Observer = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver
    const observer = typeof Observer === 'function' ? new Observer(schedule) : undefined
    observer?.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer?.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
      tag.remove()
    }
  }, 'dsh-token-dashboard: settings nav icon')
}
