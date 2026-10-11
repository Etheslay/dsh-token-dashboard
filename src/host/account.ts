/**
 * Resolving who the panel is about.
 *
 * Codex's profile panel leads with an avatar, a display name, and a handle.
 * A local harness has no such thing of its own, so the only honest source is
 * the DeepSeek account the user may be signed into — the same service `dsh-pet`
 * reads for its balance display.
 *
 * Everything here is optional and guarded. `deepseekAccount` is absent from
 * compositions that have no account platform, and `getProfile` returns `null`
 * when signed out; both cases simply drop the identity block rather than
 * inventing a placeholder name.
 *
 * @module dsh-token-dashboard/host/account
 */
import type { ProfileIdentity } from '../shared/types.ts'

/** The account shape Codex-style clients pass to every account request. */
export interface AccountClientMetadata {
  /** Client version the platform uses for compatibility gating. */
  version: string
  /** Preferred locale for platform-rendered strings. */
  locale: string
  /** Minutes offset from UTC, as the platform SDKs send it. */
  timezoneOffsetSeconds: number
}

/** The slice of `ctx.deepseekAccount` this plugin touches. */
export interface DeepseekAccountService {
  getProfile(client: AccountClientMetadata): Promise<{ name?: string | null; avatarUrl?: string | null; contact?: string | null } | null>
}

/** The slice of a Cordis context this module needs to reach an optional service. */
export interface AccountContext {
  /** Optional-service lookup; cordis returns `undefined` for `strict: false`. */
  get?(name: string, strict?: boolean): unknown
}

/** How long a resolved identity is reused before the account is asked again. */
const IDENTITY_TTL_MS = 5 * 60_000

/** Build the client metadata the platform expects. */
function clientMetadata(): AccountClientMetadata {
  let locale = 'en-US'
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale || locale
  } catch {
    /* keep the default */
  }
  return {
    version: process.env['DSH_CLIENT_VERSION'] ?? '0.0.0',
    locale,
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Read the signed-in account's display identity, if there is one.
 *
 * Never throws: a plugin whose account lookup fails should lose the avatar, not
 * the whole panel.
 * @param ctx - The host context, used to reach the optional service.
 * @returns The identity, or `undefined` when there is nothing to show.
 */
export async function resolveIdentity(ctx: AccountContext): Promise<ProfileIdentity | undefined> {
  let service: DeepseekAccountService | undefined
  try {
    service = ctx.get?.('deepseekAccount', false) as DeepseekAccountService | undefined
  } catch {
    return undefined
  }
  if (service === undefined || service === null || typeof service.getProfile !== 'function') return undefined
  try {
    const profile = await service.getProfile(clientMetadata())
    if (profile === null || profile === undefined) return undefined
    const name = typeof profile.name === 'string' && profile.name.length > 0 ? profile.name : undefined
    const handle = typeof profile.contact === 'string' && profile.contact.length > 0 ? profile.contact : undefined
    const avatarUrl = typeof profile.avatarUrl === 'string' && profile.avatarUrl.length > 0 ? profile.avatarUrl : undefined
    if (name === undefined && handle === undefined && avatarUrl === undefined) return undefined
    return {
      ...(name === undefined ? {} : { name }),
      ...(handle === undefined ? {} : { handle }),
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
    }
  } catch {
    return undefined
  }
}

/**
 * A memoizing identity reader.
 *
 * The account platform answers over the network, so the panel must not pay for
 * it on every refresh. A failed lookup is cached too, but for a shorter time, so
 * signing in is picked up without a restart.
 */
export class IdentityCache {
  private value: ProfileIdentity | undefined
  private at = 0
  private resolved = false

  /**
   * @param ttlMs - How long a successful lookup is reused.
   */
  constructor(private readonly ttlMs: number = IDENTITY_TTL_MS) {}

  /**
   * Read the cached identity, refreshing it when stale.
   * @param ctx - The host context.
   * @returns The identity, or `undefined` when there is nothing to show.
   */
  async read(ctx: AccountContext): Promise<ProfileIdentity | undefined> {
    const now = Date.now()
    if (this.resolved && now - this.at < this.ttlMs) return this.value
    this.value = await resolveIdentity(ctx)
    this.at = now
    this.resolved = true
    return this.value
  }
}
