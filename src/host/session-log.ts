/**
 * Reading DSH session logs off disk.
 *
 * A session log is `session.v<N>.jsonl.zstd`: a zstd stream built from MANY
 * concatenated frames, one per persistence flush, holding newline-delimited
 * JSON events. Two details matter and are easy to get wrong:
 *
 *   1. `zlib.zstdDecompressSync` decodes only the FIRST frame and silently
 *      returns a single line — the session header. Every log then looks empty.
 *      {@link splitZstdFrames} cuts the stream on frame magic so each frame is
 *      decoded separately, preserving order.
 *   2. The trailing frame is written while the session is still live, so a
 *      truncated final frame is normal and must not fail the whole read.
 *
 * @module dsh-token-dashboard/host/session-log
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

/** Zstandard frame magic number, little-endian `0xFD2FB528`. */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const
/** Skippable-frame magic prefix; the fourth byte carries the frame size id. */
const SKIPPABLE_MAGIC = [0x50, 0x2a] as const

/** One frame's decode outcome. */
export interface FrameDecodeResult {
  /** Concatenated UTF-8 text of every frame that decoded. */
  text: string
  /** Total frames found in the stream. */
  frames: number
  /** Frames that failed to decode, normally only a truncated tail. */
  failed: number
}

/**
 * Split a zstd stream into its concatenated frames.
 *
 * The scan is a magic-number search rather than a real parser: frame headers
 * carry no length, and a full parse would mean reimplementing zstd. A magic
 * sequence occurring inside compressed payload is possible in principle; in
 * that case the bogus split yields one extra undecodable frame, which is
 * counted in `failed` and does not affect the frames around it.
 * @param buffer - The complete file contents.
 * @returns One buffer per frame, in stream order.
 */
export function splitZstdFrames(buffer: Buffer): Buffer[] {
  const bounds: number[] = []
  for (let i = 0; i + 3 < buffer.length; i++) {
    const b0 = buffer[i]
    const b1 = buffer[i + 1]
    const isZstd =
      b0 === ZSTD_MAGIC[0] && b1 === ZSTD_MAGIC[1] && buffer[i + 2] === ZSTD_MAGIC[2] && buffer[i + 3] === ZSTD_MAGIC[3]
    const isSkippable =
      b0 === SKIPPABLE_MAGIC[0] &&
      b1 === SKIPPABLE_MAGIC[1] &&
      (buffer[i + 2]! & 0xf0) === 0x40 &&
      (buffer[i + 3]! & 0xf0) === 0x10
    if (isZstd || isSkippable) {
      bounds.push(i)
      i += 3
    }
  }
  if (bounds.length === 0) return [buffer]
  return bounds.map((start, index) => buffer.subarray(start, index + 1 < bounds.length ? bounds[index + 1]! : buffer.length))
}

/**
 * Decode an in-memory zstd session stream into text.
 * @param buffer - The complete file contents.
 * @returns The decoded text plus frame statistics.
 */
export function decodeSessionBuffer(buffer: Buffer): FrameDecodeResult {
  const frames = splitZstdFrames(buffer)
  const parts: string[] = []
  let failed = 0
  for (const frame of frames) {
    try {
      parts.push(zlib.zstdDecompressSync(frame).toString('utf8'))
    } catch {
      failed++
    }
  }
  return { text: parts.join(''), frames: frames.length, failed }
}

/**
 * Decode a session log file from disk.
 * @param file - Absolute path to a `session.v*.jsonl.zstd` file.
 * @returns The decoded text plus frame statistics.
 */
export function decodeSessionFile(file: string): FrameDecodeResult {
  return decodeSessionBuffer(fs.readFileSync(file))
}

/**
 * A parsed session-log line, before narrowing.
 *
 * Most events carry their payload under `data`, but the first `session` header
 * does NOT: it puts `id`, `createdAt`, `cwd`, and `agentPreset` directly on the
 * event. Reading `header.data.cwd` therefore yields `undefined` for every
 * session, which is exactly the bug that made the panel report the working
 * directory as `(unknown)`. The index signature keeps both shapes reachable.
 */
export interface RawLogEvent {
  /** Durable event type, for example `assistant/message`. */
  type?: string
  /** Monotonic sequence number within the log. */
  seq?: number
  /** Epoch milliseconds the harness stamped on the event. */
  time?: number
  /** Event payload; shape depends on `type`. */
  data?: Record<string, unknown>
  /** Header fields (`id`, `cwd`, `createdAt`, `agentPreset`) live here. */
  [key: string]: unknown
}

/**
 * Parse decoded log text into events, skipping undecodable lines.
 *
 * A live session's final line can be a partially flushed JSON object, so parse
 * failures are counted rather than thrown.
 * @param text - Decoded newline-delimited JSON.
 * @returns The events and the number of lines that failed to parse.
 */
export function parseLogEvents(text: string): { events: RawLogEvent[]; malformed: number } {
  const events: RawLogEvent[] = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object') events.push(parsed as RawLogEvent)
      else malformed++
    } catch {
      malformed++
    }
  }
  return { events, malformed }
}
