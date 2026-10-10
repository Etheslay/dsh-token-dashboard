# How a DSH plugin can read token usage / consumption statistics

**Research report** — factual findings from the live DSH runtime on this Windows machine.
No plugin code was written; every claim below is cited to a file + line number or to a live Inspect query.

| | |
|---|---|
| Date of research | 2026-10-10 (Asia/Shanghai) |
| DSH package versions | all `@deepseek-ai/*` inspected are **0.2.0-rc.2** |
| Active profile | `C:\Users\wu\.dsh\profiles\desktop` |
| DSH_HOME | `C:\Users\wu\.dsh` |

---

## 0. Corrections to the task's stated environment (verified)

These matter because the paths in the brief do not resolve as written.

1. **The packages are NOT under `profiles\desktop\node_modules\@deepseek-ai`.**
   That directory exists but contains only `cosmokit` and `schemastery`:

   ```
   > Get-ChildItem -LiteralPath 'C:\Users\wu\.dsh\profiles\desktop\node_modules\@deepseek-ai' -Name
   cosmokit
   schemastery
   ```

   The real, pnpm-hoisted location for every DSH package is:

   ```
   C:\Users\wu\.dsh\profiles\node_modules\@deepseek-ai\
   ```

   All file paths in this report are relative to that root unless stated otherwise.
   (`C:\Users\wu\.dsh\profiles\desktop\node_modules\` does hold the **third-party** plugins: `dsh-pet`, `dshmarket`, `dsh-better-sidebar`, `@michengai\*`.)

2. **Session logs are not plain JSONL.** They are **multi-frame Zstandard** containers named
   `session.v4.jsonl.zstd` (older generations: `session.v3.jsonl.zstd`). See §3.1.

A third correction worth flagging: **the `pwsh` tool works fine on this machine.** The brief said it fails with
`SetNamedSecurityInfoW failed`; every command in this research ran through `pwsh` successfully. (The `glob`/`grep`
tools, by contrast, returned `No files found` / `No matches found` for paths under `C:\Users\wu\.dsh`, so the shell
was the only reliable discovery path.)

3. **`app.asar` is opaque to the file tools but readable by hand.** A separate set of DSH packages (notably the
   whole `@deepseek-ai/dsh-deepseek-account*` family) is **not** in the profile's `node_modules`; it lives inside
   `D:\DSH Desktop\resources\app.asar` at `/dsh/node_modules/@deepseek-ai/…`.

   - `read` on an asar path fails with a backend error: `Cannot mix BigInt and other types, use explicit conversions`.
   - `glob` treats `app.asar` as a single *file* and returns only its own path.
   - The Electron-only `D:\DSH Desktop\resources\app.asar.unpacked\dsh\node_modules\` contains little more.

   The asar container is trivially parseable, which is how §6.2 was resolved: read `uint32LE` at offset 12 for the
   JSON header length, parse the JSON directory tree at offset 16, compute
   `baseOffset = ceil((16 + headerSize) / 4) * 4` (here `3392064`), then read `size` bytes at
   `baseOffset + Number(entry.offset)` for any file. **Caveat: the production asar ships compiled `.js` only —
   no `.d.ts` files — so type-level questions must be answered from the compiled schemas or the live Inspect API.**

---

## 1. `@deepseek-ai/dsh-token-meter`

### 1.1 What it provides: a Service, not a data store

- Service key: **`tokenMeter`**
- Registered by the plugin entry `token-meter` in the profile config:
  `C:\Users\wu\.dsh\profiles\desktop\cordis.yml:257-258` → `name: '@deepseek-ai/dsh-token-meter'`
- Class name `TokenMeter`; declared onto the Cordis context at
  `dsh-token-meter\lib\types\index.d.ts:14-18`:

```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        tokenMeter: TokenMeter;
    }
}
```

- `dsh-token-meter\lib\types\index.d.ts:71` — `export default TokenMeter;`
- The package root export is **only** `TokenMeter` — `dsh-token-meter\lib\index.js:795`:
  `export { TokenMeter, TokenMeter as default };`

**Access contract** (live Inspect `Service.listService`, `service: "tokenMeter"`):

```jsonc
"access": {
  "optional":       { "expression": "ctx.get(\"tokenMeter\")",  "requiresUndefinedCheck": true },
  "hardDependency": { "inject": ["tokenMeter"], "expression": "ctx.tokenMeter" }
}
```

### 1.2 Live Inspect signatures (verbatim, not guessed)

```ts
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement
estimateMessage(message: Message): number
```

Cross-checked against the shipped typings, `dsh-token-meter\lib\types\index.d.ts:46` and `:57`:

```ts
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement;
estimateMessage(message: Message): number;
```

`dsh-token-meter\lib\index.js:608` confirms the hard dependency it declares for itself:

```js
static inject = ["sessionProjections"];
```

### 1.3 What `measure()` actually returns — request pressure, NOT a billing total

Exact type, `dsh-token-meter\lib\types\types.d.ts:11-55`:

```ts
/** The baseline from which a signed surface delta produces current pressure. */
export type TokenMeasurementBaseline = {
    readonly kind: 'none';
    readonly tokens: 0;
} | {
    readonly kind: 'estimated';
    readonly tokens: number;
} | {
    readonly kind: 'usage';
    readonly tokens: number;
    readonly usage: Readonly<TokenUsage>;
};
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
export interface TokenMeasurement {
    /** Number of durable events consumed; equal to the next unread event seq. */
    readonly logRevision: SessionLogOffset;
    /** Provider or heuristic anchor used for this measurement. */
    readonly baseline: TokenMeasurementBaseline;
    /** Signed repricing of current surface content relative to the baseline anchor. */
    readonly surfaceDeltaTokens: number;
    /** Non-negative current request-and-response pressure. */
    readonly totalTokens: number;
    /** Total route-priced request tokens across the current surface; equals the sum of the node prices. */
    readonly surfaceTokens: number;
    /** Current surface nodes in positional head-to-tail order. */
    readonly nodes: readonly TokenSurfaceNode[];
}
/** One token-priced node in the current ordered session surface. */
export interface TokenSurfaceNode {
    readonly seq: SessionSeq;
    readonly tokens: number;
    readonly heuristicTokens: number;
}
```

> **Read this carefully:** `totalTokens` here is *"non-negative current request-and-response pressure"*
> (`types.d.ts:31-32`) — a context-window figure. It is **not** cumulative consumption and must not be summed across
> calls. `TokenMeasurementBaseline.usage` is the only place a real provider `TokenUsage` appears in this structure,
> and it is a single sample, not a total.

### 1.4 The billing counters: `tokenMeter` registers three **session projections**

This is the crux of the whole report. The cumulative consumption numbers are **not** on `ctx.tokenMeter`.
`tokenMeter` publishes them as session-projection units. `dsh-token-meter\lib\index.js:613-615`:

```js
ctx.sessionProjections.register(tokenUsageProjectionDefinition);
ctx.sessionProjections.register(contextPressureProjectionDefinition);
ctx.sessionProjections.register(contextBreakdownProjectionDefinition);
```

The three keys are declared by module augmentation in
`dsh-token-meter\lib\types\projection.d.ts:64-73`:

```ts
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Provider-reported usage accumulated across the complete durable log. */
        tokenUsage: TokenUsageProjection;
        /** Newest request pressure paired with the newest known route capacity. */
        contextPressure: ContextPressureProjection;
        /** Heuristic system/tools/message composition of the next request. */
        contextBreakdown: ContextBreakdownProjection;
    }
}
```

#### The cumulative usage record — `TokenUsageProjection`

**This is the exact TypeScript type of the usage record to use.** `dsh-token-meter\lib\types\projection.d.ts:6-17`:

```ts
/**
 * Durable cumulative provider usage for a complete session log.
 *
 * The four buckets are disjoint. In particular, reasoning tokens are already
 * included in `outputTokens` and are not accumulated again.
 */
export interface TokenUsageProjection {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
```

#### The other two projections

`dsh-token-meter\lib\types\projection.d.ts:28-46` (occupancy) and `:56-63` (composition):

```ts
export interface ContextPressureProjection {
    pressureTokens?: number;    // newest provider-reported prompt size (prompt side only)
    projectedTokens?: number;   // what the NEXT request's prompt would cost
    contextWindow?: number;     // newest advertised route capacity
}
export interface ContextBreakdownProjection {
    systemTokens: number;       // heuristic
    toolsTokens: number;        // heuristic
    messageTokens: number;      // heuristic
}
```

#### The per-step host-only state

`stateOf(session, 'tokenUsage')` returns the raw fold state, which additionally carries the **last step's** buckets —
schema at `dsh-token-meter\lib\types\usage-projection.d.ts:12-29`:

```ts
{
  totals: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  last: { turn: number; step: number;
          buckets: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
        } | null;
}
```

#### The underlying provider record — `TokenUsage`

`TokenUsage` is defined in `@deepseek-ai/dsh-llm`, not in token-meter.
Exact type, `dsh-llm\lib\types\types.d.ts:152-174` (quoted with its doc comment, which is load-bearing):

```ts
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    /**
     * Exact full-call total including aggregate prompt and output tokens.
     *
     * Adapters preserve a provider total or derive it from authoritative
     * aggregate prompt/output counters; they omit it when unavailable or
     * inconsistent.
     */
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
```

It also appears as a `StreamChunk` variant — `dsh-llm\lib\types\types.d.ts:441`:
`| { type: 'usage'; usage: TokenUsage; }`

### 1.5 Per-turn (exact, retry-aware) reading: `deriveTurnTokenUsage`

Exported from the **`./client` subpath only**, not the package root — `dsh-token-meter\lib\types\client.d.ts:6-8`:

```ts
export { deriveTurnTokenUsage } from './turn-usage.ts';
export type { TurnTokenUsage, TurnTokenUsageRoute } from './turn-usage.ts';
```

Type + signature, `dsh-token-meter\lib\types\turn-usage.d.ts:8-32`:

```ts
/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export interface TurnTokenUsage {
    /** Sum of uncached prompt input across all attempts. */
    readonly uncachedInputTokens: number;
    readonly outputTokens: number;
    /** Exact aggregate prompt plus output total across all attempts. */
    readonly totalTokens: number;
    /** Present only when every attempt reported the bucket. */
    readonly cacheReadTokens?: number;
    /** Present only when every attempt reported the bucket. */
    readonly cacheWriteTokens?: number;
    /** Output subset, present only when every attempt reported it. */
    readonly reasoningTokens?: number;
    /** Present only when every billed attempt has provider/model attribution. */
    readonly routes?: readonly TurnTokenUsageRoute[];
}
export declare function deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined;
```

`TurnTokenUsageRoute` is `{ readonly provider: string; readonly model: string }` (`turn-usage.d.ts:3-6`).
This is the **only** built-in way to get per-model attribution, and it is per-turn (see §3.5).

### 1.6 Answers to the specific sub-questions

| Question | Answer |
|---|---|
| Per-session? | **Yes** — every projection read is scoped to one `Session`. |
| Cumulative? | `tokenUsage` = **yes, cumulative over the whole durable log** (`projection.d.ts:7`). `measure()` = no. |
| Per-model? | **No cumulative per-model breakdown.** Only `TurnTokenUsage.routes` (per completed turn, and only when every attempt is attributed). Per-model totals require your own fold (§7.3). |
| input/output/cached/reasoning breakdown? | input (**uncached only**), output, cacheRead, cacheWrite. **Reasoning is *not* a separate bucket** — `projection.d.ts:9-10`: *"reasoning tokens are already included in `outputTokens`"*. |
| Cost / money? | **None.** No currency, price, or cost field exists in `TokenUsage`, `TokenUsageProjection`, `TurnTokenUsage`, or `TokenMeasurement`. The only "pricing" in the package is `priceSurface()` for *image token* pricing (`dsh-token-meter\lib\types\route-pricing.d.ts:14-29`) — token counts, not money. Money lives in `ctx.deepseekAccount.getBalance()` (§6.2). |

### 1.7 Package documentation (corroborating)

`dsh-token-meter\README.md` documents the intended read paths:

- `:36` — *"`ctx.tokenMeter` exposes two operations."*
- `:39-40` — the canonical snippet:
  ```ts
  const { totalTokens, surfaceTokens, nodes } = ctx.tokenMeter.measure(session)
  const price = ctx.tokenMeter.estimateMessage(message)
  ```
- `:49` — *"When the composition provides `ctx.sessionProjections`, token-meter registers three projection units.
  `tokenUsage` carries the complete durable log's `uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, and
  `cacheWriteTokens`."* … *"Unloading the plugin removes all three keys."*
- `:55` — `deriveTurnTokenUsage(events)` folds one complete turn into exact per-attempt usage.

---

## 2. `@deepseek-ai/dsh-session-stats`

### 2.1 It is NOT a Service — it is a projection unit

There is **no `sessionStats` service key**. A live `Service.listService` catalog query returns keys
`sessionController, sessionFeedback, sessionFileReferences, sessionPersistence, sessionProjectionCache,
sessionProjections, sessionQuery, sessionReferenceResolver, sessions, sessionSkillCatalog, sessionTelemetry,
sessionTitle` — and no `sessionStats`.

`dsh-session-stats` is a **function plugin** that registers one projection key.
Registered in the profile at `cordis.yml:423-424` → `name: '@deepseek-ai/dsh-session-stats'`.

`dsh-session-stats\lib\types\index.d.ts:13-22`:

```ts
/** Cordis plugin name. */
export declare const name = "session-stats";
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
```

`dsh-session-stats\lib\index.js:186-198` — `name = "session-stats"`, `inject = ["sessionProjections"]`,
`ctx.sessionProjections.register(sessionStatsProjectionDefinition)`, `export { apply, inject, name }`.

### 2.2 Data shape — `sessionStats`

Exact type, `dsh-session-stats\lib\types\types.d.ts:18-35`:

```ts
export interface SessionStatsProjection {
    /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
    turns: number;
    /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
    steps: number;
    /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
    llmMs: number;
    /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
    toolMs: number;
    /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
    ttftMs: number;
    /** Steps carrying a recorded first token. */
    ttftSteps: number;
    /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
    decodeMs: number;
    /** Summed provider output tokens over the same decode-timed steps. */
    decodeTokens: number;
}
```

Augmentation, `dsh-session-stats\lib\types\types.d.ts:36-41`:

```ts
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        sessionStats: SessionStatsProjection;
    }
}
```

### 2.3 How it differs from token-meter

| | `dsh-token-meter` | `dsh-session-stats` |
|---|---|---|
| Exposes a Service | **Yes** — `ctx.tokenMeter` (2 methods) | **No** — function plugin only |
| Projection keys | `tokenUsage`, `contextPressure`, `contextBreakdown` | `sessionStats` |
| Token counters | **4 disjoint billing buckets** (uncached input, output, cacheRead, cacheWrite) | **`decodeTokens` only** — output tokens, and only over steps that also reported a decode time |
| Input / cache tokens | Yes | **No** |
| Timing / turn / step counters | No | **Yes** (`turns`, `steps`, `llmMs`, `toolMs`, `ttftMs`, `ttftSteps`, `decodeMs`) |
| Primary purpose | Billing-accurate token accounting + context pressure | Conversation statistics and wall times |

**They are complementary, not alternatives.** For consumption statistics, `tokenUsage` is the authority.
`sessionStats` is useful only for latency/"performance" panels and cannot tell you what was billed for input.

---

## 3. The session event log

### 3.1 Physical format — a concatenated-frame Zstandard container

- Directory root: `C:\Users\wu\.dsh\sessions\<encoded-cwd>\<session-id>\session.v<version>.jsonl.zstd`
  (configured at `cordis.yml:75-78`: `root: !!js dshHomePath('sessions')`).
- On this machine: **30 `.jsonl.zstd` files** across 7 project directories; both `v3` and `v4` generations exist for
  migrated sessions (they contain identical records — the v4 file is the migrated current generation).

Format facts, cited to `dsh-session-persistence-jsonl\lib\index.js`:

- `:2285` — `const DEFAULT_COMPRESSION = "zstd";`
- `:1283-1285` — *"The backend owns a concatenated-frame container so it can append and recover batches
  without exposing compression mechanics through the persistence seam."*
- `:1288` — `const ZSTD_MAGIC = 4247762216;`  (= `0xFD2FB528`, i.e. bytes `28 b5 2f fd` little-endian)
- `:1300` — `function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY)`
- `:1369` — `async function compressZstdFrame(input)` (one independently decodable, checksummed frame)
- `:1892-1893` — `assertIndependentHeaderFrame`: *"the first frame is exactly one header line"*
- `:3184-3192` — the header and the first event batch are compressed as **two separate frames**:
  `Buffer.concat([headerFrame, eventFrame])`

**Verified empirically.** The file begins `28 b5 2f fd 04 58 ed 04 00 …` (valid zstd magic + frame header,
`Content_Checksum_flag = 1`, no dictionary), and Node's one-shot API decodes only the first frame:

```
> zlib.zstdDecompressSync(readFileSync(file))      // returns 201 bytes only
{"type":"session","version":4,"id":"session-07ee0b86-…","createdAt":1791637362310,"cwd":"D:\\dsh-token-dashboard",
 "isSeeded":false,"delegationDepth":0,"agentPreset":"cordis"}
```

Decompressing all frames (`zstd -d -c`, or the package's private multi-frame decoder at
`dsh-session-persistence-jsonl\lib\index.js:1157`) yields the full JSONL stream.

**Practical consequence:** if a plugin reads these files directly, `zlib.zstdDecompressSync` / `zstdDecompress`
silently returns only the header record. Use `zstd -d` / a multi-frame decoder — **or, far better, do not touch files
at all** and use `ctx.sessionQuery` / `ctx.sessionProjections` (§4).

### 3.2 The event that carries token usage

Event type: **`assistant/message`**. Numbers live at **`data.usage`**.

From the live `Service.listService` referenced type `SessionEventMap` (also
`dsh-session\lib\types\*.d.ts`):

```ts
'assistant/message': {
    turn: number;
    step: number;
    message: AssistantMessage;
    stream: AssistantStreamRecord[];
    usage?: TokenUsage;
    interrupted?: true;
};
'assistant/attempt': {
    turn: number;
    step: number;
    stream: AssistantStreamRecord[];
};
```

Envelope (`SessionEvent`): `{ type, seq, time, data, ignorable?, surfaceOp?, sourceEventSeqs? }`.

**Field names are the camelCase `TokenUsage` names — not `prompt_tokens` / `completion_tokens`.**
The snake_case wire names are translated inside the adapter
(`dsh-llm-deepseek\lib\index.js:1808-1821`):

```js
function updateUsage(usage, raw) {
	const fields = object(raw);
	for (const [wire, local] of Object.entries({
		input_tokens: "inputTokens",
		output_tokens: "outputTokens",
		cache_read_input_tokens: "cacheReadTokens",
		cache_creation_input_tokens: "cacheWriteTokens"
	})) { … usage[local] = value; }
}
```

and `totalTokens` is **derived**, not received — `dsh-llm-deepseek\lib\index.js:1993`:

```js
usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
```

### 3.3 Verbatim real examples

These are exact substrings copied out of decompressed logs. `L<n>` = the n-th JSONL record in the decompressed
stream (the `.zstd` file has no line numbers). The `"usage":{…}` object is quoted **verbatim**; the surrounding
event is long because `data.message` and `data.stream` are inlined in the same record.

**Example A — current adapter (`deepseek-flash`, cache write bucket present, reasoning absent)**
File: `C:\Users\wu\.dsh\sessions\--D-dsh-token-dashboard--\session-07ee0b86-cd33-445f-928c-e38ba0362f46\session.v4.jsonl.zstd`
Envelope: `type=assistant/message`, `seq=19`, `data.turn=1`, `data.step=1` (L21)

```json
"usage":{"inputTokens":12499,"outputTokens":111,"cacheReadTokens":1920,"cacheWriteTokens":0,"totalTokens":14530}
```

**Example B — same session, warm cache (shows `inputTokens` is the *uncached* remainder)**
`type=assistant/message`, `seq=27`, `data.turn=1`, `data.step=2` (L29)

```json
"usage":{"inputTokens":241,"outputTokens":175,"cacheReadTokens":14336,"cacheWriteTokens":0,"totalTokens":14752}
```

**Example C — older log, `reasoningTokens` present and `cacheWriteTokens` absent**
File: `C:\Users\wu\.dsh\sessions\--D-GPT-Sovits~0020Web--\session-0be42e4d-6451-47e9-8bb7-f2a9809f386b\session.v3.jsonl.zstd`
Envelope: `type=assistant/message`, `seq=16`, `data.turn=1`, `data.step=1` (L18)

```json
"usage":{"inputTokens":2226,"outputTokens":310,"totalTokens":14952,"cacheReadTokens":12416,"reasoningTokens":74}
```

**Example D — cold cache (all-cache buckets zero)**
File: `C:\Users\wu\.dsh\sessions\--D-dsh-token-dashboard--\session-3c2a8a3c-78df-40c2-842c-e544f7ee8efa\session.v4.jsonl.zstd`
`type=assistant/message`, `seq=18`, `data.turn=1`, `data.step=1` (L20)

```json
"usage":{"inputTokens":9279,"outputTokens":266,"cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":9545}
```

### 3.4 Cumulative or per-turn? — **PER-TURN (per model call)**

The numbers in `data.usage` are **not cumulative**. Proof: in `session-0be42e4d-…v3` (511 usage records) the
individual samples are small (e.g. `inputTokens: 2226`, `cacheReadTokens: 12416`) while the session's summed
`cacheReadTokens` is **186,152,704**. A cumulative field could not be smaller than the running total.

The **cumulative** figure is produced only by the `tokenUsage` projection (§1.4), which folds exactly these records.

### 3.5 Full-population field survey (all 30 session files, 3512 usage records)

I decompressed every session log and tabulated every `data.usage` object.

**Exactly two distinct key sets exist — and nothing else:**

| key set | records |
|---|---|
| `cacheReadTokens, inputTokens, outputTokens, reasoningTokens, totalTokens` | 2572 |
| `cacheReadTokens, cacheWriteTokens, inputTokens, outputTokens, totalTokens` | 940 |

Consequences, all verified:

1. **`cacheWriteTokens` is only ever `0`** in this dataset — never a non-zero value was observed.
2. **`reasoningTokens` is present in 2572 records and absent in 940.** It is *not* model-dependent here: the
   `reasoningTokens`-bearing session `0be42e4d` runs `provider=deepseek-official, model=deepseek-flash`
   (extracted from its `assistant/message.source`), i.e. the *same* provider/model as the sessions that lack the
   field. The split follows **which adapter code wrote the record**, not the model. The current adapter
   (`dsh-llm-deepseek\lib\index.js:1808-1821`, Messages API) never emits `reasoningTokens`; older records do.
3. Because `v4` files for migrated sessions contain the *same* historical records as `v3`, old `reasoningTokens`
   records survive migration — so **both shapes appear in the current-format corpus**.
4. **`totalTokens` is exactly the sum of the four buckets, in all 30 files.** For every one of the 30 logs,
   `Σ(inputTokens+outputTokens+cacheReadTokens+cacheWriteTokens)` equalled `Σ(totalTokens)` to the unit. This
   independently confirms the derivation at `dsh-llm-deepseek\lib\index.js:1993` and the "disjoint buckets" doc at
   `dsh-llm\lib\types\types.d.ts:155-158`.

Sanity check on Example A: `12499 + 111 + 1920 + 0 = 14530 = totalTokens` ✓.
On Example B: `241 + 14336 + 175 + 0 = 14752 = totalTokens` ✓.

> **Trap:** because `reasoningTokens ⊆ outputTokens` (`projection.d.ts:9-10`), **never** add `reasoningTokens` into a
> grand total. It is a subset, and the projection deliberately does not accumulate it.

### 3.6 Alternative read path: the embedded stream

`data.stream` (on both `assistant/message` and `assistant/attempt`) contains the raw chunk log, including
`{ type: 'chunk', chunk: { type: 'usage', usage: TokenUsage } }`. The in-tree headless renderer reads usage this way
because it is retry-complete — a retried attempt's usage survives only in `assistant/attempt`.

`dsh-headless\lib\json-stream-BA-F3lfb.js:117-119`:

```js
/** The usage a provider reported in one attempt's stream, if any. */
function streamUsage(stream) {
	return lastAssistantStreamChunk(stream, "usage")?.usage;
}
```

and `:131-157` accumulates a *step's* usage across attempts, deliberately marking the step **incomplete** rather than
publishing a partial sum:

```js
if (next === void 0) return { usage: state.usage, complete: false };
…
inputTokens: total.inputTokens + next.inputTokens,
outputTokens: total.outputTokens + next.outputTokens,
…totalTokens === void 0 ? {} : { totalTokens },
…cacheReadTokens === void 0 ? {} : { cacheReadTokens },
…cacheWriteTokens === void 0 ? {} : { cacheWriteTokens },
…reasoningTokens === void 0 ? {} : { reasoningTokens }
```

This is a good model to copy if exact retry accounting matters to you.

---

## 4. `dsh-session-projection` and `dsh-session-query-sqlite`

### 4.1 `ctx.sessionProjections` — the registry you actually read

Service key **`sessionProjections`**. Plugin `session-projection` → `@deepseek-ai/dsh-session-projection`
(`cordis.yml:86-87`). Class `SessionProjectionRegistry`,
`dsh-session-projection\lib\types\index.d.ts:134`. Context augmentation at `:23-27`.

Live Inspect access contract:

```jsonc
"access": {
  "optional":       { "expression": "ctx.get(\"sessionProjections\")", "requiresUndefinedCheck": true },
  "hardDependency": { "inject": ["sessionProjections"], "expression": "ctx.sessionProjections" }
}
```

Live Inspect signatures (verbatim):

```ts
register<K extends keyof SessionProjectionMap, S extends SessionProjectionStateMap[K]>(
  definition: Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: NonNullable<ProjectionDefinition<K, S>['wire']> },
): () => void
register<K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>, S extends SessionProjectionStateMap[K]>(
  definition: Omit<ProjectionDefinition<K, S>, 'wire'>,
): () => void
onChanged(listener: ProjectionChangeListener): () => void
stateOf<K extends keyof SessionProjectionStateMap>(session: Session, key: K): SessionProjectionStateMap[K] | undefined
snapshot(session: Session, keys?: readonly Extract<keyof SessionProjectionMap, string>[]): ProjectionSnapshot
cachedSnapshot(session: Session, keys?: readonly Extract<keyof SessionProjectionMap, string>[]): ProjectionSnapshot | undefined
checkpoint(session: Session): ProjectionCheckpoint
restoreFloor(checkpoint: ProjectionCheckpoint): SessionLogOffset | undefined
viewCheckpoint(checkpoint: ProjectionCheckpoint, keys?: readonly Extract<keyof SessionProjectionMap, string>[]): Partial<SessionProjectionMap>
restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset, header: SessionHeader, inheritedEventCount: SessionLogOffset): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }
hydrate(session: Session, checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset): ProjectionSnapshot
```

Supporting types, `dsh-session-projection\lib\types\index.d.ts:86,92-97,106-115`:

```ts
export type ProjectionChangeListener =
  (session: Session, key: Extract<keyof SessionProjectionMap, string>, value: unknown, seq: SessionSeq) => void;
export interface ProjectionSnapshot {
    asOfSeq: SessionSeqCursor;              // SessionSeq | -1
    values: Partial<SessionProjectionMap>;
}
export interface ProjectionCheckpointRow { ver: number; seq: SessionSeqCursor; val: unknown; }
export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>;
```

The registry's own doc (`index.d.ts:117-133`) states the three facts a consumer needs:

> *"The service subscribes to `session/event` once; every committed event passes every registered unit's `apply` (eager
> drive). … Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds
> `init` over the in-memory log on first touch (event or read). Registration is an effect (disposer rides the calling
> fiber): an unloaded domain plugin's key disappears from snapshots and clients read it as capability absence. A host
> reader either declares `sessionProjections` in its plugin `inject` or fails explicitly when the registry or required
> key is absent."*

`snapshot()` doc (`:177-184`): *"One consistent cut over every registered client-visible unit for one session… Fully
synchronous… Each value passes its unit's `viewSchema` before leaving."*

### 4.2 `ctx.sessionQuery` — read stored sessions

Service key **`sessionQuery`**; concrete backend `@deepseek-ai/dsh-session-query-sqlite`
(`cordis.yml:81-84`), which is *"Concrete `ctx.sessionQuery` backend with SQLite FTS5 search"*
(`dsh-session-query-sqlite\package.json` description).

Live Inspect signatures (abridged to the reads that matter; full list in §4.3 of the query I ran):

```ts
listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
readSession(sessionId: SessionId): Promise<SessionLogSnapshot>
filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>
listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>
readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>
observeSession(sessionId: SessionId, options: SessionObservationOptions = {}): Promise<SessionObservation>
readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>
abstract searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>
abstract searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>
```

`readSession` returns exactly what the projection cold path needs:

```ts
export interface SessionLogSnapshot {
    session: SessionHeader;
    inheritedEventCount: SessionLogOffset;
    events: SessionEvent[];
}
```

#### ⚠️ This profile disables full-text search

`cordis.yml:81-84`:

```yaml
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: never
```

`dsh-session-query-sqlite\lib\types\index.d.ts:26-27,39-43`:

```ts
/** SQLite module/handle opening phase; `never` disables full-text search entirely. */
export type OpenAt = 'startup' | 'first-search' | 'never';
…
* …or `never` to disable full-text search: the inherited exact reads, filters, and traces stay
* available, while `searchSessions` and `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED`
* and SQLite is never imported or opened. Defaults to `startup`.
```

**So: `searchSessions` / `searchEvents` will throw on this machine. `listSessions`, `readSession`, `listEvents`,
`readSurface`, `readEvent`, `filterSessions` work.** Do not build a dashboard on text search here.

### 4.3 `ctx.sessionProjectionCache` — the cold/persisted read

Service key **`sessionProjectionCache`**, *"The persisted projection cache service."*
Plugin `session-projection-cache` (`cordis.yml:98-101`, `writeEveryEvents: 200`, `writeIntervalMs: 5000`).

Live Inspect signatures:

```ts
cachedSnapshot(meta: SessionHeader, keys?: readonly Extract<keyof SessionProjectionMap, string>[]): ProjectionSnapshot | undefined
cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined
hydratePrepared(session: Session, events: readonly SessionEvent[]): ProjectionSnapshot
async write(session: Session): Promise<void>
coldSnapshot(meta: SessionHeader, inheritedEventCount: SessionLogOffset, events: readonly SessionEvent[]): ProjectionSnapshot
```

`coldSnapshot` is the zero-live-Session answer for a dashboard: feed it the three fields of a `SessionLogSnapshot`
and it returns a `ProjectionSnapshot` whose `values.tokenUsage` is the cumulative usage.

### 4.4 Also available

- `ctx.sessions` — *"In-memory session store (`ctx.sessions`)."* Methods: `list(): Session[]`, `get(id)`,
  `create`, `prepare`, `fork`, `flush`, `enter`, `announce`, `registerMessageProjection`.
  `ctx.sessions.list()` gives you the **live** `Session` objects that `snapshot()` needs.
- `ctx.sessionPersistence` — low-level stored-log handle access (not inspected in depth here).

---

## 5. Reachability from a third-party host plugin

All of the following are ordinary host Services on the **top-level** host context, are **not** isolated inside an
agent-preset group, and are therefore reachable from a third-party host plugin via `ctx.<key>` or `inject`.
None are internal-only.

| Service key | Provided by | Hard-dep idiom | Soft-get idiom | Reachable? |
|---|---|---|---|---|
| `tokenMeter` | `@deepseek-ai/dsh-token-meter` (`cordis.yml:257`) | `inject: ['tokenMeter']` → `ctx.tokenMeter` | `ctx.get('tokenMeter')` | **Yes** |
| `sessionProjections` | `@deepseek-ai/dsh-session-projection` (`cordis.yml:86`) | `inject: ['sessionProjections']` | `ctx.get('sessionProjections')` | **Yes** |
| `sessionProjectionCache` | `@deepseek-ai/dsh-session-projection-cache` (`cordis.yml:98`) | `inject: ['sessionProjectionCache']` | `ctx.get(...)` | **Yes** |
| `sessionQuery` | `@deepseek-ai/dsh-session-query-sqlite` (`cordis.yml:81`) | `inject: ['sessionQuery']` | `ctx.get('sessionQuery')` | **Yes** |
| `sessions` | `@deepseek-ai/dsh-session` (`cordis.yml:18`) | `inject: ['sessions']` | `ctx.get('sessions')` | **Yes** |
| `deepseekAccount` | `@deepseek-ai/dsh-deepseek-account-platform` (`cordis.yml:65`) | `inject: ['deepseekAccount']` | `ctx.get('deepseekAccount', false)` | **Yes** |
| `llm` | `@deepseek-ai/dsh-llm` (`cordis.yml:14`) | `inject: ['llm']` | `ctx.get('llm')` | **Yes** |
| `sessionTelemetry` | `@deepseek-ai/dsh-session-telemetry-otel` (`cordis.yml:105`) | `inject: [...]` | — | Yes, but see below |

**No `sessionStats` service exists** — `@deepseek-ai/dsh-session-stats` contributes only the `sessionStats`
projection key, read through `ctx.sessionProjections`. There is nothing to inject for it.

**Caveat on `sessionTelemetry`:** the catalog documents the *backend* contract as
*"Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the
`telemetry` key throws on a duplicate"* (methods: `sharing`, `emit(record)`, `flush?`, `shutdown()`). That is an
outbound telemetry **sink**, not a reader. Whether a plugin could usefully *tap* it as a consumption source is
**UNVERIFIED** — I did not inspect `SessionTelemetryRecord`'s fields (the grep against
`dsh-session-telemetry\lib\types\*.d.ts` for token fields returned nothing, but the type files it did ship are
`coordinator.d.ts` and `index.d.ts` only, so I did not identify the record shape).

**Important dependency note (verified, not a guess):** `@deepseek-ai/dsh-token-meter`'s own
`peerDependencies` (`dsh-token-meter\package.json:38-46`) are
`@deepseek-ai/cordis ~4.0.4`, `dsh-compaction`, `dsh-llm`, `dsh-session-projection`, `dsh-compaction-image-offload`,
`dsh-llm-retry`, `dsh-session`, all pinned to `0.2.0-rc.2`. Installing the package as a dependency of your plugin
must resolve against those exact versions.

---

## 6. Do existing plugins already display token usage?

### 6.1 The three plugins named in the brief — result: **NO**

I grepped each for `tokenMeter|sessionProjections|tokenUsage|inputTokens|cacheReadTokens|uncachedInput`.

| Plugin | Path | Result |
|---|---|---|
| `dsh-pet` | `C:\Users\wu\.dsh\profiles\desktop\node_modules\dsh-pet\src` | **No matches.** It does not read token usage at all. |
| `@michengai/dsh-codex-ui` | `…\node_modules\@michengai\dsh-codex-ui` | **No token API.** 4 matches, all in `CHANGELOG.md` (`:130`, `:155`, `:178`, `:194`) describing a *settings page* it opens — e.g. *"Embed the original billing component in a same-origin usage statistics frame"*. It references someone else's billing UI; it reads no tokens. |
| `dshmarket` | `…\node_modules\dshmarket` | **No matches.** |

### 6.2 But `dsh-pet` IS a proven working example — of **account balance**, not tokens

This is worth stating precisely because the brief asked for it. `dsh-pet` reads the **DSH account money balance**
through `ctx.deepseekAccount.getBalance()`, via a *soft* service get (it deliberately keeps the service out of
`inject`). `dsh-pet\src\host\index.ts:549-556`:

```ts
// `deepseek-account`（免费额度 / 平台登录）没有 API Key：它的凭证是 DSH 账号服务
// 持有的授权记录，只能经 getBalance 查询。账号服务是**可选**服务（软取，不放进
// inject）——没装账号插件时它不在场，此时该路由报 credential-missing 而不是崩。
async () => {
  const account = ctx.get('deepseekAccount', false);
  if (!account) return undefined;
  return account.getBalance(accountClientMetadata());
},
```

with the metadata argument built at `dsh-pet\src\host\index.ts:528-537`:

```ts
const accountClientMetadata = (): { version: string; locale: string; timezoneOffsetSeconds: number } => {
  let version = '0.0.0';
  try {
    const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof raw.version === 'string' && raw.version.length > 0) version = raw.version;
  } catch { /* 读不到不影响查询 */ }
  return { version, locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
};
```

The service contract (live Inspect, `deepseekAccount`) is
`abstract getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null>`, and the service is
documented as *"Account operations; only Host consumers can obtain a request credential."*

The returned snapshot shape, as modelled by the consumer — `dsh-pet\src\host\balance\types.ts:113-124`:

```ts
/**
 * DSH 账号服务的余额快照（`ctx.deepseekAccount.getBalance()` 的返回，只取用到的字段）。
 * 与 `dsh-deepseek-account` 的 `AccountDetails['balance']` 同构：`ready` 带两个钱包数组，
 * `failed` 是"查过但失败"（与"没登录"的 null 不同）。
 */
export interface AccountBalanceSnapshot {
  status: 'ready' | 'failed';
  /** 充值钱包（normal_wallets），金额是保留服务端精度的十进制字符串 */
  value?: readonly { currency?: unknown; balance?: unknown }[];
  /** 赠送钱包（bonus_wallets） */
  bonusWallets?: readonly { currency?: unknown; balance?: unknown }[];
}
```

Its parser (`dsh-pet\src\host\balance\providers\deepseek-account.ts:23-58`) reads
`snapshot.value[0].currency` / `.balance` as the topped-up wallet and `snapshot.bonusWallets[]` as granted, and
`MoneyBalance.total = granted + toppedUp` (`:50`). Note it **throws rather than fabricating a zero**
(`:27-31`: *"充值钱包为空 … → 报错而非显示 ¥0.00"*).

**The authoritative shape — recovered from the shipped implementation.** The account packages are **not** in the
profile's `node_modules`; they live inside `D:\DSH Desktop\resources\app.asar` at
`/dsh/node_modules/@deepseek-ai/dsh-deepseek-account{,-platform}` (located by parsing the asar header — see §0).
The production asar strips `.d.ts` files, but the compiled zod schema is definitive.
From `dsh-deepseek-account-platform\lib\types\details.js` (asar, compiled):

```js
const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const wallet = z.object({
    currency: z.enum(['CNY', 'USD']), balance: z.string().regex(decimal),
});
const summary = z.object({ normal_wallets: z.array(wallet), bonus_wallets: z.array(wallet) });
…
balance: { path: '/api/v0/users/get_user_summary', parse: (value) => {
        const parsed = summary.safeParse(value);
        if (!parsed.success) throw new PlatformAuthError('protocol');
        return { status: 'ready', value: parsed.data.normal_wallets, bonusWallets: parsed.data.bonus_wallets };
    } },
…
    catch (error) { … return { status: 'failed' }; }
```

So the runtime value of `AccountDetails['balance']` is:

```ts
{
  status: 'ready';
  value:         readonly { currency: 'CNY' | 'USD'; balance: string }[];  // normal_wallets (recharge)
  bonusWallets:  readonly { currency: 'CNY' | 'USD'; balance: string }[];  // bonus_wallets (granted)
} | { status: 'failed' }
```

and `getBalance()` resolves **`null`** when not signed in (per the Inspect signature
`Promise<AccountDetails['balance'] | null>`) — distinct from `{ status: 'failed' }`, which means *queried and failed*.
Amounts are **decimal strings** with an exponent-tolerant grammar (the comment notes `0E-16`, `1e+3` are valid), and
*"failure never becomes a zero balance"*.

This **confirms `dsh-pet`'s `AccountBalanceSnapshot` model above is faithful** — same `status` union, same two wallet
arrays. `dsh-pet`'s `MoneyBalance.total = granted + toppedUp` mapping is its own presentation choice, not part of the
service contract.

### 6.3 Better proven examples: official in-tree consumers

Since none of the three named plugins reads tokens, the real references are first-party:

**A. Cumulative session usage, client side** — `dsh-client-ui-chat\lib\client.js:7133`:

```js
const usage = useProjection("tokenUsage");
```

and `:6606-6607`:

```js
usageAction: detailed && data.tokenUsage !== void 0 ? jsx(TurnUsagePanel, { usage: data.tokenUsage }) : …
```

**B. Per-turn usage** — `dsh-client-ui-chat\lib\client.js:10427`:

```js
const tokenUsage = context.start?.event.type === "turn/start"
  ? deriveTurnTokenUsage(context.matches.map((match) => match.event).filter(isSessionEvent))
  : void 0;
```

with the node contract at `dsh-client-ui-chat\lib\types\client\contract\chat-nodes.d.ts:80`:
`readonly tokenUsage?: TurnTokenUsage;` — i.e. the official UI uses **exactly** the two paths described in §1.4
and §1.5.

**C. Host-side, retry-exact** — `dsh-headless\lib\json-stream-BA-F3lfb.js:117-157` (§3.6).

> **Client-side note:** `useProjection` is **not** a module export — it is injected as a prop into the client
> component tree (`dsh-client-ui-chat\lib\client.js:5130` and `:7130` both receive `useProjection` as a parameter).
> A repo-wide grep for `useProjection` across all `@deepseek-ai\**\*.d.ts` returned **no matches**, so it is supplied
> by the client runtime, not by an importable package. I attempted to enumerate the client `Builtin` and client
> `Service` catalogs to confirm the client API, and **both client Inspect queries timed out**
> (`Client inspect query … timed out after 10000ms. Open or reconnect the Harness page, then retry.`).
> → *The exact client-side projection hook API is **UNVERIFIED**.* The host-side path in §7 is fully verified.

---

## 7. Recommended implementation

### 7.1 Recommended primary data source

> **Read the `tokenUsage` session projection through `ctx.sessionProjections`.**
>
> - **Live session:** `ctx.sessionProjections.snapshot(session, ['tokenUsage']).values.tokenUsage`
>   (or `stateOf(session, 'tokenUsage')` for the `totals` + `last` step detail).
> - **Cold / persisted session:** `ctx.sessionQuery.readSession(id)` → feed the snapshot's three fields to
>   `ctx.sessionProjectionCache.coldSnapshot(...)`.
> - **Change notification:** `ctx.sessionProjections.onChanged(listener)` (fires only when the wire value actually
>   changes, by `Object.is`).
>
> **Do not** parse `session.v4.jsonl.zstd` files yourself, and **do not** use `ctx.tokenMeter.measure()` as a
> consumption total — it is a context-pressure figure.

Why: it is cumulative, per-session, disjoint and billing-accurate, and schema-validated before it leaves the host
(`index.d.ts:180-181`). The registry keeps per-session watermark cells, so reads are incremental — **except the very
first read of a session older than the registry, which folds the whole in-memory log once** (see gotcha 5). It is also
the exact path the first-party UI uses.

Use `deriveTurnTokenUsage` from `@deepseek-ai/dsh-token-meter/client` only when you need **per-turn** or
**per-model-attributed** figures.

### 7.2 Minimal host-side read path (TypeScript sketch)

```ts
// Host half of a third-party DSH plugin.
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
// Type-only import: brings BOTH the type and the `SessionProjectionMap` augmentation.
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'

export const name = 'token-dashboard'

/** Hard deps: ctx.sessionProjections / ctx.sessionQuery / ctx.sessionProjectionCache are guaranteed present. */
export const inject = ['sessionProjections', 'sessionQuery', 'sessionProjectionCache']

export function apply(ctx: Context) {
  const log = ctx.logger('token-dashboard')   // ctx.logger is LoggerService; ctx.logger(name) => Logger
                                              // LoggerMethod = (format: any, ...param: any[]) => void

  // ---- A. Live session: cumulative totals (synchronous, one consistent cut) ----
  const liveTotals = (session: Session): TokenUsageProjection | undefined =>
    ctx.sessionProjections.snapshot(session, ['tokenUsage']).values.tokenUsage

  // ---- B. Live session: totals + the last completed step's buckets ----
  const withLastStep = (session: Session) =>
    ctx.sessionProjections.stateOf(session, 'tokenUsage')   // { totals, last } | undefined

  // ---- C. Event-driven: react to each committed model call ----
  // 'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
  ctx.on('session/event', (session: Session, event) => {
    if (event.type !== 'assistant/message') return
    // event.data.usage is the per-call sample; event.data.turn / .step locate it.
    const totals = liveTotals(session)
    log.debug('usage session=%s step=%d', session.id, event.data.step)
    //   ^ event.data.usage (per call) and `totals` (cumulative) are yours to store
  })

  // ---- D. Change feed: only when a wire value actually changed (Object.is) ----
  ctx.effect(() => ctx.sessionProjections.onChanged((session, key, value, seq) => {
    if (key !== 'tokenUsage') return
    const totals = value as TokenUsageProjection      // schema-validated by the host
    // seq: SessionSeq at which it changed; session: the owning Session
  }))

  // ---- E. Cold / persisted session with no live Session object ----
  const coldTotals = async (id: SessionId) => {
    const snap = await ctx.sessionQuery.readSession(id)   // { session, inheritedEventCount, events }
    const projections = ctx.sessionProjectionCache.coldSnapshot(
      snap.session,
      snap.inheritedEventCount,
      snap.events,
    )
    return { totals: projections.values.tokenUsage, asOfSeq: projections.asOfSeq }
  }

  // ---- F. Enumerate the live corpus ----
  const allLive = () => ctx.sessions.list().map((s) => ({ id: s.id, totals: liveTotals(s) }))
}
```

### 7.3 If you need a per-model breakdown

There is no built-in cumulative per-model total. Two verified options:

1. **Per-turn, exact, retry-aware** — call `deriveTurnTokenUsage(turnEvents)` on the events from `turn/start`
   through `turn/end` and read `.routes` (`turn-usage.d.ts:20-21`). It returns `undefined` unless *every* billed
   attempt has attribution, lifecycle evidence is complete, counts are safe, and totals do not conflict
   (`turn-usage.d.ts:24-32`). Use this when correctness matters more than coverage.
2. **Your own fold** — accumulate `event.data.usage` keyed by
   `event.data.message.source.provider` / `.model` for each `assistant/message`. This is straightforward and exact,
   because `ModelMessageSource` carries the attribution inline: `message.source` is
   `{ kind: 'model', provider, model, replayState? }` (`AssistantProviderMetadata`, from the Inspect reference set).
   I verified this shape is present on real records — e.g. `"source":{"kind":"model","provider":"deepseek-official",
   "model":"deepseek-flash","replayState":…}`.

Caveat for option 2: `assistant/attempt` events (retries) carry no `usage`; only the stream inside them does
(§3.6). If retries matter, fold the stream chunks instead.

---

## 8. Gotchas

**Availability / versioning**
1. The `tokenUsage` / `contextPressure` / `contextBreakdown` keys exist **only while the `token-meter` plugin is
   loaded**. `dsh-token-meter\README.md:49`: *"Unloading the plugin removes all three keys."*
   `values.tokenUsage` is then simply absent — always handle `undefined`.
2. Same for `sessionStats`: `dsh-session-stats\lib\types\index.d.ts:15` — *"without it the fiber stays pending."*
3. If you read projections, either declare `sessionProjections` in `inject` or use `ctx.get('sessionProjections')`
   and handle `undefined`. The registry's own doc (`index.d.ts:126-129`) frames this as a deliberate choice:
   *"A host reader either declares `sessionProjections` in its plugin `inject` or fails explicitly when the registry
   or required key is absent."* For genuinely optional sources, `ctx.inject(['sessionProjections'], …)` is the
   documented middle path.
4. `token-meter` is absent from the **minimal / ptc / standard** agent-preset plugin lists — it is a top-level host
   plugin (`cordis.yml:257`). It is present in this profile; on a different DSH version or profile it may not be.

**Async / laziness / consistency**
5. `snapshot()`, `stateOf()`, `cachedSnapshot()`, `checkpoint()`, `viewCheckpoint()`, `restore()`, `hydrate()` are
   **synchronous**, but the *first* read of a session older than the registry **folds the whole in-memory log
   lazily** (`index.d.ts:122-124`). First touch can therefore be O(log); subsequent reads are incremental.
6. `snapshot()` is a consistent cut — every value and `asOfSeq` reflect the same log position (`index.d.ts:178-180`).
   Do not mix values from two different `snapshot()` calls and call them simultaneous.
7. `cachedSnapshot` is explicitly **not** a complete baseline: *"Values may trail the live Session and are therefore
   hints, not a complete baseline."* (`index.d.ts:188-189`). The persisted cache writes every 200 events / 5000 ms
   (`cordis.yml:100-101`), so it lags. `coldSnapshot(...)` with freshly read events is exact.
8. `stateOf()` returns the **live** cell: *"The returned value is live; callers must not mutate it."*
   (`index.d.ts:170`).
9. `coldSnapshot` / `restore` throw when a checkpoint row is unusable **and** `baseSeq > 0`, because refolding from
   `init` is only sound over the full log (`index.d.ts:248-253`). Catch and re-read from seq 0.

**Lifecycle / disposal**
10. Registration and `onChanged` are **effects on the calling fiber**: *"Registration is an effect (disposer rides the
    calling fiber)."* `register()` and `onChanged()` each return an exact disposer. If you register them, unload
    cleanly — a leaked registration keeps a key alive in every snapshot. Read-only consumption needs no disposal
    beyond the listener you registered.
11. `ProjectionChangeListener` receives `value: unknown` and `key` narrowed to a string, **not** to
    `'tokenUsage'` — cast, as in the sketch.

**TypeScript**
12. `SessionProjectionMap` and `SessionProjectionStateMap` are **empty interfaces** unless the augmenting packages
    are in your compilation. Both the Inspect-rendered declarations confirm this:
    `export interface SessionProjectionMap {}` / `export interface SessionProjectionStateMap {}`.
    Without a type-only `import … from '@deepseek-ai/dsh-token-meter'` (or your own `declare module` augmentation),
    `snapshot().values.tokenUsage` will not typecheck.

**File-level reading (only if you must bypass the services)**
13. Multi-frame zstd: one-shot `zstdDecompressSync` returns **only the header line** (§3.1). You need a multi-frame
    decoder or the `zstd` CLI. Node here is v24.15.0; `D:\Anaconda\Library\bin\zstd.exe` is also present.
14. The first frame is *exactly one line* — the session header — by contract
    (`dsh-session-persistence-jsonl\lib\index.js:1892-1893`).
15. Logs **grow while the session is live**. During this research `session-07ee0b86-…\session.v4.jsonl.zstd` went
    from 387 to 603 decompressed records as the session kept running. Appended frames mean record line numbers of
    *earlier* records stay stable, but any total is a moving target.
16. `totalTokens` is derived, not provider-supplied
    (`dsh-llm-deepseek\lib\index.js:1993`) — it always equals the four-bucket sum, so it carries no extra
    information.
17. `reasoningTokens ⊆ outputTokens` (`projection.d.ts:9-10`). Never add it to a total.
18. `reasoningTokens` presence depends on which adapter version wrote the record, **not** on the model (§3.5). Treat
    it as optional and never assume it means "reasoning was off" when absent.
19. `cacheWriteTokens` was **0 or absent in every one of the 3512 records** on this machine. Do not assume a
    non-zero cache-write channel exists for DeepSeek.
20. **No cost/currency data exists anywhere in the token path.** If the dashboard needs money, that is a separate
    integration: `ctx.deepseekAccount.getBalance(metadata)` (§6.2), which is a network-backed account query, not a
    token count.

---

## 9. Explicitly UNVERIFIED

Listed rather than guessed:

1. **The `AccountDetails` name as a *TypeScript declaration*.** No `.d.ts` anywhere under
   `@deepseek-ai\*\lib\**` contains `AccountDetails` — because the account packages are not installed in the
   profile's `node_modules` at all, and the copy inside `app.asar` ships only compiled `.js` (no types).
   The **runtime shape is now verified** from the compiled zod schema (§6.2); only the original `.d.ts`
   spelling of the interface is unavailable. `AccountDetails['balance']` as a type name comes from the
   Inspect-rendered method signature.
2. **The client-side projection API.** `useProjection` is injected as a component-tree prop
   (`dsh-client-ui-chat\lib\client.js:5130`, `:7130`), appears in **no** `.d.ts`, and both client Inspect queries
   (`Builtin.listBuiltins`, `Service.listService`) timed out at 10 s with *"Open or reconnect the Harness page, then
   retry."* So how a third-party **client** plugin obtains `tokenUsage` is not established here.
3. **`SessionTelemetryRecord`'s fields.** `dsh-session-telemetry` ships only `lib\types\coordinator.d.ts` and
   `lib\types\index.d.ts`; I did not identify a token-carrying record, so `sessionTelemetry` as a *consumption*
   source is unassessed.
4. **`@deepseek-ai/dsh-headless` as a plugin dependency.** I read its usage fold as a *reference implementation*;
   I did not verify it is loadable as a third-party dependency, nor what `projectJsonRun`'s `ctx` requires.
5. **Behaviour on other DSH versions.** Everything here is `0.2.0-rc.2`. I did not test a version where
   `token-meter` or `session-stats` is absent, and I did not check whether older versions exposed a different
   projection key set.
6. **The exact `.jsonl.zstd` frame-to-event-batch mapping over time** (how many events per appended frame). I
   verified the container rules and the header-frame rule, but not the per-batch frame sizes.
7. **The second DSH install** at `C:\Users\wu\AppData\Roaming\dsh-desktop\harness\profiles\node_modules\@deepseek-ai`
   — the directory exists, but `dsh-token-meter` / `dsh-session-stats` were not found under it, so I did not
   characterise that install.

---

## 10. Copy-paste reference card

```ts
// Service keys
ctx.tokenMeter                                  // measure(session, requestHeader?) => TokenMeasurement
                                                // estimateMessage(message) => number

ctx.sessionProjections.snapshot(session, ['tokenUsage'])          // => { asOfSeq, values: { tokenUsage? } }
ctx.sessionProjections.stateOf(session, 'tokenUsage')             // => { totals, last } | undefined
ctx.sessionProjections.cachedSnapshot(session, ['tokenUsage'])    // hint only, may lag
ctx.sessionProjections.onChanged(listener)                        // => disposer

ctx.sessionQuery.listSessions()                                   // SessionRecord[]
ctx.sessionQuery.readSession(sessionId)                           // { session, inheritedEventCount, events }
ctx.sessionQuery.listEvents(sessionId)                            // SessionEventRecord[]
// NOTE: searchSessions / searchEvents THROW here — openAt: 'never' in this profile

ctx.sessionProjectionCache.coldSnapshot(header, inheritedEventCount, events)  // => ProjectionSnapshot
ctx.sessionProjectionCache.cachedSnapshot(header, keys?)                      // => ProjectionSnapshot | undefined

ctx.sessions.list()                                               // live Session[]

// The usage record you want
interface TokenUsageProjection {           // key: 'tokenUsage'
  uncachedInputTokens: number              // prompt tokens NOT served from cache
  outputTokens: number                     // includes reasoning tokens
  cacheReadTokens: number
  cacheWriteTokens: number
}
// total billed tokens = uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens

// The per-call sample on the event log
// session.v4.jsonl.zstd -> { type: 'assistant/message', seq, time,
//   data: { turn, step, message, stream, usage?: TokenUsage, interrupted? } }
interface TokenUsage {                     // @deepseek-ai/dsh-llm
  inputTokens: number                      // UNCACHED input only
  outputTokens: number
  totalTokens?: number                     // == sum of the four, adapter-derived
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number                 // subset of outputTokens; older records only
}

// Per-turn / per-model, from '@deepseek-ai/dsh-token-meter/client'
deriveTurnTokenUsage(turnEvents)           // => TurnTokenUsage | undefined

// Money (separate concern, network-backed)
ctx.get('deepseekAccount', false)?.getBalance({ version, locale, timezoneOffsetSeconds })
```

---

## Appendix — Inspect queries performed

| Query | Result |
|---|---|
| `host / Service.listService` (directory) | Full catalog; located `tokenMeter`, `sessionProjections`, `sessionQuery`, `sessionProjectionCache`, `sessions`, `deepseekAccount`, `llm` |
| `host / Service.listService` `service: tokenMeter` | Exact signatures + access contract + `TokenUsage` declaration |
| `host / Service.listService` `service: sessionProjections` | 11 exact signatures + access contract |
| `host / Service.listService` `service: sessionQuery` | 15 exact signatures + access contract |
| `host / Event.listEvents` (directory) | 71 events; `session/event` signature confirmed |
| `client / Builtin.listBuiltins` | **timed out (10 s)** |
| `client / Service.listService` | **timed out (10 s)** |

The full catalog response was spilled to
`C:\Users\wu\AppData\Local\Temp\dsh-spill-1hozz1\session-5544e814882e\fdc06b699a85-cordis_inspect_query.txt`
(2065 lines); catalog line references above (e.g. `:1152`, `:1173`, `:1212`) are line numbers **in that file**.
