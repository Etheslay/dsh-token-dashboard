/**
 * Browser half of dsh-token-dashboard.
 *
 * Registers one `settings.section` page. The page itself does no measuring: it
 * fetches the snapshot the Host half already computed and renders it, which
 * keeps every filesystem and zstd concern out of the browser bundle.
 *
 * @module dsh-token-dashboard/client
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { UsageSection, makeTranslate } from './panel.tsx'
import { installSettingsNavIcon } from './nav-icon.ts'
import { PANEL_CSS, STYLE_ID } from './styles.ts'
import { en, zh } from './locales.ts'

/** Locale namespace, deliberately equal to the package name. */
export const NS = 'dsh-token-dashboard'

/** Section id this page is registered under. */
export const SECTION_ID = 'usage'

/** Sort position: after the built-in model/plugin pages, before "About". */
export const SECTION_ORDER = 45

/** The locale surface this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): unknown
  bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
  getLocale?(): { active?: string }
}

/** The slot surface this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: (props: Record<string, unknown>) => ReactNode): unknown
}

/** The client Cordis context shape this plugin relies on. */
interface UsageClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

export const name = NS

/**
 * `slots` is required — without it there is no settings page at all. `locale`
 * is required too: `ui-settings` already hard-depends on it, and the section
 * label has to be translated.
 */
export const inject = ['slots', 'locale']

/**
 * Mount the settings page.
 * @param ctx - The client Cordis context.
 */
export function apply(ctx: UsageClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-dashboard: dictionaries')

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = NS
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = PANEL_CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-token-dashboard: panel styles')

  const t = ctx.locale.bind(NS)

  // The section registration's label is a thunk so a locale switch re-labels
  // the nav row; the same thunk drives the icon claimer, so the two can never
  // drift apart.
  installSettingsNavIcon(ctx, () => t('nav'))

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      },
      (props: Record<string, unknown>) =>
        createElement(UsageSection, {
          t: typeof props['t'] === 'function' ? (props['t'] as never) : makeTranslate({}, en),
        }),
    ),
  )
}
