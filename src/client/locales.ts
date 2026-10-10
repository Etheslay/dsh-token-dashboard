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
  nav: '用量',

  title: '用量统计',
  subtitle: '读取本机会话日志的 token 消耗，不做任何模型调用。',
  loading: '正在统计…',
  refresh: '刷新',
  refreshing: '统计中…',
  retry: '重试',
  updatedAt: '更新于 {time}',
  scanTook: '本次扫描 {ms} ms',

  rangeToday: '今天',
  range7d: '7 天',
  range30d: '30 天',
  rangeAll: '全部',

  sessionBlock: '会话',
  model: '模型',
  modelProvider: '模型提供方',
  directory: '工作目录',
  session: '会话',
  preset: '预设',
  turns: '轮次',
  moreDirectories: '+{n} 个目录',

  tokenUsage: 'Token 用量',
  tokenUsageValue: '{total} total',
  tokenUsageDetail: '（{input} 输入 + {output} 输出）',
  contextWindow: '上下文窗口',
  cache: '缓存命中',
  cacheValue: '{percent}% 命中',
  cacheDetail: '（{read} 读取 / {prompt} 提示词）',
  reasoning: '推理',
  noContext: '尚无请求上下文记录',

  rangeOf: '区间合计',
  rangeCompare: '较上一区间 {delta}',
  promptTokens: '提示词',
  cachedTokens: '缓存读取',
  cacheWriteTokens: '缓存写入',
  outputTokens: '输出',
  totalTokens: '合计',
  sessionsCount: '会话',
  turnsCount: '轮次',

  lifetimeTokens: '累计 token',
  peakTokens: '单日峰值',
  longestChat: '最长对话',
  currentStreak: '当前连续',
  longestStreak: '最长连续',
  days: '{n} 天',
  dayOne: '{n} 天',
  peakOn: '峰值出现在 {date}',

  activityTitle: 'Token 活动',
  activitySince: '有记录的 {n} 天',
  activityEmpty: '这段时间还没有记录。',
  activityLess: '少',
  activityMore: '多',

  byModel: '按模型',
  byWorkspace: '按工作目录',
  breakdownEmpty: '这段时间还没有用量。',

  recentSessions: '最近的会话',
  colTokens: 'Token',
  colTurns: '轮次',
  colModel: '模型',
  colUpdated: '更新',
  currentSession: '当前',
  untitled: '未命名会话',

  warningsTitle: '警告',
  errTitle: '读不到用量数据',
  errHint: '宿主侧的 dsh-token-dashboard 插件没有响应。请确认它已启用。',
  staleHint: '数据可能已过期，重新加载可刷新。',
}

/** English dictionary. */
export const en: Record<string, string> = {
  nav: 'Usage',

  title: 'Usage',
  subtitle: 'Token spend read from this machine’s session logs. No model calls.',
  loading: 'Measuring…',
  refresh: 'Refresh',
  refreshing: 'Measuring…',
  retry: 'Retry',
  updatedAt: 'updated {time}',
  scanTook: 'scan took {ms} ms',

  rangeToday: 'Today',
  range7d: '7d',
  range30d: '30d',
  rangeAll: 'All',

  sessionBlock: 'Session',
  model: 'Model',
  modelProvider: 'Model provider',
  directory: 'Directory',
  session: 'Session',
  preset: 'Preset',
  turns: 'Turns',
  moreDirectories: '+{n} more',

  tokenUsage: 'Token usage',
  tokenUsageValue: '{total} total',
  tokenUsageDetail: '({input} input + {output} output)',
  contextWindow: 'Context window',
  cache: 'Cache',
  cacheValue: '{percent}% hit',
  cacheDetail: '({read} read / {prompt} prompt)',
  reasoning: 'Reasoning',
  noContext: 'no request context recorded yet',

  rangeOf: 'In range',
  rangeCompare: '{delta} vs previous',
  promptTokens: 'Prompt',
  cachedTokens: 'Cached',
  cacheWriteTokens: 'Cache write',
  outputTokens: 'Output',
  totalTokens: 'Total',
  sessionsCount: 'Sessions',
  turnsCount: 'Turns',

  lifetimeTokens: 'Lifetime tokens',
  peakTokens: 'Peak tokens',
  longestChat: 'Longest chat',
  currentStreak: 'Current streak',
  longestStreak: 'Longest streak',
  // Codex prints `{days} days` with no singular form. English grammar is a
  // locale detail rather than part of the panel design, so this one is fixed.
  days: '{n} days',
  dayOne: '{n} day',
  peakOn: 'peak on {date}',

  activityTitle: 'Token activity',
  activitySince: '{n} days on record',
  activityEmpty: 'Nothing recorded in this window yet.',
  activityLess: 'Less',
  activityMore: 'More',

  byModel: 'By model',
  byWorkspace: 'By directory',
  breakdownEmpty: 'No usage in this window yet.',

  recentSessions: 'Recent sessions',
  colTokens: 'Tokens',
  colTurns: 'Turns',
  colModel: 'Model',
  colUpdated: 'Updated',
  currentSession: 'current',
  untitled: 'Untitled session',

  warningsTitle: 'Warnings',
  errTitle: 'Usage data unavailable',
  errHint: 'The Host half of dsh-token-dashboard did not answer. Check that the plugin is enabled.',
  staleHint: 'Figures may be stale — reload to refresh.',
}
