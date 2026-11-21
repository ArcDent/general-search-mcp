/**
 * Key pool shared by the Search Layer and the Crawl Layer.
 *
 * Each layer holds one pool over its configured API keys. For every tool call
 * the pool picks a key, and when the upstream rejects that key it benches it and
 * moves on to the next usable key within the same call. State lives in memory
 * only: the stdio process restarts with each client session, so a fresh process
 * starts with every key usable again.
 */
import type { KeyRotation } from "./config.js";

const HOUR_MS = 3_600_000;
/** Longest cooldown honoured from a Retry-After header. */
const MAX_RETRY_AFTER_MS = 24 * HOUR_MS;
/** First cooldown for a 429 without Retry-After; doubles per repeat, capped at an hour. */
const BACKOFF_BASE_MS = 60_000;

/** What a failed request says about the key that made it. */
export interface KeyFailure {
  status: number;
  /** Seconds from a Retry-After header, when the engine exposes one. */
  retryAfterSec?: number;
  /** Bench the key but rethrow instead of trying the next key. */
  noRetry?: boolean;
}

interface KeyState {
  /** Rejected as invalid (401); unusable until the process restarts. */
  disabled: boolean;
  /** Epoch ms until which the key is cooling down. */
  until: number;
  /** Consecutive 429s without Retry-After, driving the backoff. */
  strikes: number;
  /** HTTP status that last benched the key, for the summary. */
  status?: number;
}

/** Read a Retry-After header given in seconds; anything else yields undefined. */
export function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export class KeyPool {
  private readonly states: KeyState[];
  private cursor = 0;

  constructor(
    private readonly name: string,
    private readonly keys: string[],
    private readonly rotation: KeyRotation,
    private readonly now: () => number = Date.now,
  ) {
    this.states = keys.map(() => ({ disabled: false, until: 0, strikes: 0 }));
  }

  /**
   * Run one request, trying each usable key at most once. With no key or a
   * single key there is nothing to rotate to, so the request runs exactly as
   * it did before key rotation: once, with the upstream error passed through
   * and no cooldown. Errors that `classify` does not map to a key failure are
   * rethrown as is; when every key has been benched the call fails with a
   * summary.
   */
  async run<T>(
    request: (key: string) => Promise<T>,
    classify: (error: unknown) => KeyFailure | undefined,
  ): Promise<T> {
    if (this.keys.length <= 1) return request(this.keys[0] ?? "");
    const benched = new Set<number>();
    for (const i of this.order()) {
      // A concurrent call may have benched this key while we were waiting.
      if (!this.usable(i)) continue;
      // Falling over onto the key the cursor points at: move the cursor past
      // it, so the next round-robin call starts on a different key.
      if (this.rotation === "round-robin" && this.cursor === i) {
        this.cursor = (i + 1) % this.keys.length;
      }
      try {
        const result = await request(this.keys[i]);
        this.states[i].strikes = 0;
        return result;
      } catch (error) {
        const failure = classify(error);
        if (!failure || !this.bench(i, failure)) throw error;
        benched.add(i);
        if (failure.noRetry) throw error;
      }
    }
    throw new Error(this.summary(benched));
  }

  /** Replace every configured key in `text` with its slot number. */
  redact(text: string): string {
    // Longest first, so a key that contains another key is masked whole.
    return this.keys
      .map((key, i) => ({ key, slot: i + 1 }))
      .sort((a, b) => b.key.length - a.key.length)
      .reduce((out, { key, slot }) => out.split(key).join(`[key #${slot}]`), text);
  }

  private usable(i: number): boolean {
    const state = this.states[i];
    return !state.disabled && this.now() >= state.until;
  }

  /** Usable key indexes for this call, in the order to try them. */
  private order(): number[] {
    const n = this.keys.length;
    const start = this.rotation === "round-robin" ? this.cursor : 0;
    const order = Array.from({ length: n }, (_, k) => (start + k) % n).filter((i) =>
      this.usable(i),
    );
    // Claim the first slot now, so concurrent round-robin calls start apart.
    if (order.length > 0) this.cursor = (order[0] + 1) % n;
    return order;
  }

  /** Record a key-level failure. Returns false when the status is not about the key. */
  private bench(i: number, { status, retryAfterSec }: KeyFailure): boolean {
    const state = this.states[i];
    const now = this.now();
    let cooldown: number;
    if (status === 401) {
      if (!state.disabled) state.status = status;
      state.disabled = true;
      return true;
    } else if (status === 402 || status === 432 || status === 433) {
      // Out of credits or over a plan limit: retry the key after an hour.
      cooldown = HOUR_MS;
    } else if (status === 429) {
      if (retryAfterSec !== undefined) {
        cooldown = Math.min(retryAfterSec * 1000, MAX_RETRY_AFTER_MS);
      } else if (now < state.until) {
        // A concurrent call already backed this key off for the same burst.
        cooldown = 0;
      } else {
        cooldown = Math.min(BACKOFF_BASE_MS * 2 ** state.strikes, HOUR_MS);
        state.strikes += 1;
      }
    } else {
      return false;
    }
    // A disabled key keeps its reason; a cooldown never shortens a longer one.
    if (!state.disabled && now + cooldown >= state.until) {
      state.until = now + cooldown;
      state.status = status;
    }
    return true;
  }

  /**
   * Why no key is usable: counts, slots and statuses only, never key text.
   * Keys benched during this call count as cooling even if a zero or very
   * short cooldown has already run out.
   */
  private summary(benched: Set<number>): string {
    const now = this.now();
    const disabled: string[] = [];
    const cooling: string[] = [];
    let earliest = Infinity;
    this.states.forEach((state, i) => {
      if (state.disabled) {
        disabled.push(`#${i + 1} HTTP ${state.status}`);
      } else if (now < state.until || benched.has(i)) {
        cooling.push(`#${i + 1} HTTP ${state.status}`);
        earliest = Math.min(earliest, Math.max(0, state.until - now));
      }
    });
    const parts = [
      `${disabled.length} of ${this.keys.length} disabled${
        disabled.length ? ` (${disabled.join(", ")})` : ""
      }`,
      `${cooling.length} cooling down${cooling.length ? ` (${cooling.join(", ")})` : ""}`,
    ];
    if (cooling.length) parts.push(`earliest retry in ${Math.ceil(earliest / 1000)}s`);
    const restart = disabled.length
      ? ". Disabled keys were rejected as invalid and stay off until the server restarts"
      : "";
    return `no usable ${this.name} key: ${parts.join(", ")}${restart}`;
  }
}
