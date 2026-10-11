/**
 * Panel copy in the two languages the harness ships.
 *
 * Namespace is `dsh-token-dashboard`, matching the package name so the section
 * registration can pass one string for both `locale` and `inject`.
 *
 * @module dsh-token-dashboard/client/locales
 */

/** Simplified Chinese dictionary. */
export const zh: Record<string, string> = {
  // The settings nav shows this next to the section's glyph. It names the whole
  // page rather than just "usage", because the page is a statistics report — the
  // headline figures, a year of activity, and the breakdowns — not only a number.
  nav: '\u7528\u91cf\u7edf\u8ba1',
  title: '\u7528\u91cf\u7edf\u8ba1',
  refresh: '\u5237\u65b0',
  refreshing: '\u7edf\u8ba1\u4e2d\u2026',
  updatedAt: '\u66f4\u65b0\u4e8e {time}',
  scanTook: '\u626b\u63cf {ms} ms',

  statLifetime: '\u7d2f\u8ba1 Token \u6570',
  statPeak: 'Token \u4f7f\u7528\u5cf0\u503c',
  statLongest: '\u6700\u957f\u4efb\u52a1\u7528\u65f6',
  statLongestStreak: '\u6700\u957f\u8fde\u7eed\u5929\u6570',
  statCurrentStreak: '\u5f53\u524d\u8fde\u7eed\u5929\u6570',
  days: '{n} \u5929',
  dayOne: '{n} \u5929',

  activity: 'Token \u6d3b\u52a8',
  modeDaily: '\u6bcf\u5929',
  modeWeekly: '\u6bcf\u5468',
  modeCumulative: '\u7d2f\u8ba1\u603b\u91cf',
  less: '\u5c11',
  more: '\u591a',
  noActivity: '\u8fd9\u6bb5\u65f6\u95f4\u8fd8\u6ca1\u6709\u8bb0\u5f55\u3002',
  cellTooltip: '{date} \u00b7 {value} token',
  weekOf: '{date} \u8d77\u7684\u4e00\u5468',

  insights: '\u6d1e\u5bdf',
  mostUsed: '\u6700\u5e38\u4f7f\u7528',
  statReasoning: '\u6700\u5e38\u7528\u7684\u63a8\u7406\u5f3a\u5ea6',
  statSkillsExplored: '\u5df2\u63a2\u7d22\u6280\u80fd\u6570',
  statSkillsTotal: '\u4f7f\u7528\u7684\u6280\u80fd\u603b\u6570',
  statChats: '\u603b\u4f1a\u8bdd\u6570',
  statTurns: '\u603b\u8f6e\u6b21',
  statModels: '\u6700\u5e38\u7528\u7684\u6a21\u578b',
  statCache: '\u7f13\u5b58\u547d\u4e2d\u7387',
  runs: '{n} \u6b21',
  runOne: '{n} \u6b21',
  // Terse on purpose, matching the reference panel's `high · 26%`. The long
  // form ("占 token 的 100%") ellipsized the row label in a real settings panel.
  shareRequests: '{value} \u00b7 {pct}%',
  shareTokens: '{value} \u00b7 {pct}%',
  none: '\u6682\u65e0\u8bb0\u5f55',

  errTitle: '\u8bfb\u4e0d\u5230\u7528\u91cf\u6570\u636e',
  staleHostTitle: '\u63d2\u4ef6\u5df2\u66f4\u65b0\uff0c\u9700\u8981\u91cd\u542f DSH',
  staleHostHint: '\u6d4f\u89c8\u5668\u4fa7\u5df2\u662f\u65b0\u7248\u672c\uff0c\u4f46\u5bbf\u4e3b\u4fa7\u8fd8\u5728\u8dd1\u65e7\u7248\u672c\uff08Node \u6a21\u5757\u7f13\u5b58\u4e0d\u4f1a\u968f\u6587\u4ef6\u66ff\u6362\u800c\u5931\u6548\uff09\u3002\u91cd\u542f DSH \u540e\u5373\u53ef\u3002',
  errHint: '\u5bbf\u4e3b\u4fa7\u7684 dsh-token-dashboard \u63d2\u4ef6\u6ca1\u6709\u54cd\u5e94\u3002\u8bf7\u786e\u8ba4\u5b83\u5df2\u542f\u7528\u3002',
  staleHint: '\u6570\u636e\u53ef\u80fd\u5df2\u8fc7\u671f\uff0c\u91cd\u65b0\u52a0\u8f7d\u53ef\u5237\u65b0\u3002',
  warningsTitle: '\u8b66\u544a',
}

/** English dictionary. */
export const en: Record<string, string> = {
  nav: 'Usage',
  title: 'Usage',
  refresh: 'Refresh',
  refreshing: 'Measuring…',
  updatedAt: 'updated {time}',
  scanTook: 'scan {ms} ms',

  statLifetime: 'Lifetime tokens',
  statPeak: 'Peak tokens',
  statLongest: 'Longest chat',
  statLongestStreak: 'Longest streak',
  statCurrentStreak: 'Current streak',
  // Codex prints `{days} days` with no singular form. English grammar is a
  // locale detail rather than part of the panel design, so this one is fixed.
  days: '{n} days',
  dayOne: '{n} day',

  activity: 'Token activity',
  modeDaily: 'Daily',
  modeWeekly: 'Weekly',
  modeCumulative: 'Cumulative',
  less: 'Less',
  more: 'More',
  noActivity: 'Nothing recorded in this window yet.',
  cellTooltip: '{date} · {value} tokens',
  weekOf: 'week of {date}',

  insights: 'Insights',
  mostUsed: 'Most used',
  statReasoning: 'Most used reasoning',
  statSkillsExplored: 'Skills explored',
  statSkillsTotal: 'Total skills used',
  statChats: 'Total chats',
  statTurns: 'Total turns',
  statModels: 'Most used model',
  statCache: 'Cache hit rate',
  runs: '{n} runs',
  runOne: '{n} run',
  // Terse on purpose, matching the reference panel's `high · 26%`.
  shareRequests: '{value} · {pct}%',
  shareTokens: '{value} · {pct}%',
  none: 'None recorded',

  errTitle: 'Usage data unavailable',
  staleHostTitle: 'Plugin updated — restart DSH',
  staleHostHint: 'The browser half is the new build but the Host half is still running the old one (a replaced ES module stays cached in the Node process). Restart DSH to finish.',
  errHint: 'The Host half of dsh-token-dashboard did not answer. Check that the plugin is enabled.',
  staleHint: 'Figures may be stale — reload to refresh.',
  warningsTitle: 'Warnings',
}
