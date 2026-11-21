// Key pool rules, driven by a fake clock. Runs against the compiled build.
import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPool, parseRetryAfter } from "../build/keys.js";

const KEYS = ["secret-key-aaa", "secret-key-bbb", "secret-key-ccc"];
const SEC = 1000;

/** A pool over `n` keys with a clock the test moves by hand. */
function makePool(n = 2, rotation = "sequential") {
  const clock = { t: 1_000_000 };
  const pool = new KeyPool("Test", KEYS.slice(0, n), rotation, () => clock.t);
  return { pool, clock };
}

const classify = (error) => error;

/** Run one call; `fail` maps a key to the failure it should throw, if any. */
async function call(pool, fail = () => undefined) {
  const used = [];
  try {
    await pool.run(async (key) => {
      used.push(key);
      const failure = fail(key);
      if (failure) throw failure;
      return "ok";
    }, classify);
    return { used, error: undefined };
  } catch (error) {
    return { used, error };
  }
}

/** Fail key #1 once with `failure`, then report which key a new call starts with at each offset. */
async function firstKeyAfter(failure, offsetsSec) {
  const { pool, clock } = makePool(2);
  await call(pool, (key) => (key === KEYS[0] ? failure : undefined));
  const start = clock.t;
  const firsts = [];
  for (const offset of offsetsSec) {
    clock.t = start + offset * SEC;
    firsts.push((await call(pool)).used[0]);
  }
  return firsts;
}

test("sequential keeps using key #1", async () => {
  const { pool } = makePool(2);
  for (let i = 0; i < 3; i++) assert.deepEqual((await call(pool)).used, [KEYS[0]]);
});

test("round-robin moves to the next key on every call", async () => {
  const { pool } = makePool(2, "round-robin");
  const firsts = [];
  for (let i = 0; i < 3; i++) firsts.push((await call(pool)).used[0]);
  assert.deepEqual(firsts, [KEYS[0], KEYS[1], KEYS[0]]);
});

test("401 disables a key for the rest of the process", async () => {
  const { pool, clock } = makePool(2);
  const first = await call(pool, (key) => (key === KEYS[0] ? { status: 401 } : undefined));
  assert.deepEqual(first.used, [KEYS[0], KEYS[1]]);
  assert.equal(first.error, undefined);
  clock.t += 100 * 3600 * SEC;
  assert.deepEqual((await call(pool)).used, [KEYS[1]]);
});

for (const status of [402, 432, 433]) {
  test(`${status} cools a key down for 3600 seconds`, async () => {
    assert.deepEqual(await firstKeyAfter({ status }, [3599, 3600]), [KEYS[1], KEYS[0]]);
  });
}

test("429 with Retry-After cools down for that long, at most 86400 seconds", async () => {
  assert.deepEqual(
    await firstKeyAfter({ status: 429, retryAfterSec: 120 }, [119, 120]),
    [KEYS[1], KEYS[0]],
  );
  assert.deepEqual(
    await firstKeyAfter({ status: 429, retryAfterSec: 100_000 }, [86_399, 86_400]),
    [KEYS[1], KEYS[0]],
  );
});

test("429 without Retry-After backs off 60s, doubling to 3600s, reset by a success", async () => {
  const { pool, clock } = makePool(2);
  // A probe that fails with 400 shows whether key #1 is offered first,
  // without changing any key's state.
  const offeredAt = async (t) => {
    clock.t = t;
    return (await call(pool, () => ({ status: 400 }))).used[0] === KEYS[0];
  };
  // Fail #1 with 429 now, then check it is still off at d-1 seconds and back at d.
  const expectCooldown = async (d) => {
    await call(pool, (key) => (key === KEYS[0] ? { status: 429 } : undefined));
    const start = clock.t;
    assert.equal(await offeredAt(start + (d - 1) * SEC), false, `off at ${d - 1}s`);
    assert.equal(await offeredAt(start + d * SEC), true, `back at ${d}s`);
  };
  for (const d of [60, 120, 240, 480, 960, 1920, 3600, 3600]) await expectCooldown(d);
  // One success clears the streak, so the next 429 starts at 60s again.
  assert.equal((await call(pool)).error, undefined);
  await expectCooldown(60);
});

test("400 and 500 leave the key alone and are rethrown", async () => {
  for (const status of [400, 500]) {
    const { pool } = makePool(2);
    const result = await call(pool, (key) => (key === KEYS[0] ? { status } : undefined));
    assert.deepEqual(result.used, [KEYS[0]]);
    assert.deepEqual(result.error, { status });
    assert.deepEqual((await call(pool)).used, [KEYS[0]]);
  }
});

test("one call tries each of 3 keys once when all return 429", async () => {
  const { pool } = makePool(3);
  const result = await call(pool, () => ({ status: 429 }));
  assert.deepEqual(result.used, KEYS);
  assert.match(result.error.message, /no usable Test key/);
});

test("noRetry benches the key but rethrows without trying the next one", async () => {
  const { pool } = makePool(2);
  const failure = { status: 402, noRetry: true };
  const result = await call(pool, () => failure);
  assert.deepEqual(result.used, [KEYS[0]]);
  assert.equal(result.error, failure);
  assert.deepEqual((await call(pool)).used, [KEYS[1]]);
});

test("summary counts disabled and cooling keys without key text", async () => {
  const { pool } = makePool(3);
  const failures = {
    [KEYS[0]]: { status: 401 },
    [KEYS[1]]: { status: 432 },
    [KEYS[2]]: { status: 429, retryAfterSec: 30 },
  };
  const { error } = await call(pool, (key) => failures[key]);
  assert.match(error.message, /1 of 3 disabled/);
  assert.match(error.message, /2 cooling down/);
  assert.match(error.message, /earliest retry in 30s/);
  for (const key of KEYS) assert.ok(!error.message.includes(key));
  // A call while nothing is usable fails at once with the same summary.
  const again = await call(pool);
  assert.deepEqual(again.used, []);
  assert.match(again.error.message, /1 of 3 disabled/);
});

test("a single key runs as before: upstream error passed through, no cooldown", async () => {
  const { pool } = makePool(1);
  const limited = { status: 429 };
  assert.equal((await call(pool, () => limited)).error, limited);
  assert.deepEqual((await call(pool)).used, [KEYS[0]]);
  const invalid = { status: 401 };
  assert.equal((await call(pool, () => invalid)).error, invalid);
  assert.deepEqual((await call(pool)).used, [KEYS[0]]);
});

test("round-robin moves past a key it fell over onto", async () => {
  const { pool } = makePool(3, "round-robin");
  const first = await call(pool, (key) =>
    key === KEYS[0] ? { status: 429, retryAfterSec: 1000 } : undefined,
  );
  assert.deepEqual(first.used, [KEYS[0], KEYS[1]]);
  assert.equal((await call(pool)).used[0], KEYS[2]);
});

/** Start a call whose first request, on `heldKey`, waits until released with a failure. */
function heldCall(pool, heldKey, fail = () => undefined) {
  const used = [];
  let release;
  const held = new Promise((_, reject) => (release = reject));
  const done = pool
    .run(async (key) => {
      used.push(key);
      if (key === heldKey && used.length === 1) return held;
      const failure = fail(key);
      if (failure) throw failure;
      return "ok";
    }, classify)
    .then(
      () => undefined,
      (error) => error,
    );
  return { used, release: (failure) => release(failure), done };
}

test("a call skips a key a concurrent call benched, and one 429 burst backs off once", async () => {
  const { pool, clock } = makePool(3);
  const fail = (key) => (key === KEYS[1] ? { status: 401 } : undefined);
  const a = heldCall(pool, KEYS[0], fail);
  const b = heldCall(pool, KEYS[0], fail);
  const start = clock.t;
  a.release({ status: 429 });
  await a.done;
  b.release({ status: 429 });
  await b.done;
  assert.deepEqual(a.used, [KEYS[0], KEYS[1], KEYS[2]]);
  // #2 was disabled by the other call, so this one goes straight to #3.
  assert.deepEqual(b.used, [KEYS[0], KEYS[2]]);
  // Both 429s came from one burst: #1 is back after 60s, not 120s.
  clock.t = start + 59 * SEC;
  assert.equal((await call(pool)).used[0], KEYS[2]);
  clock.t = start + 60 * SEC;
  assert.equal((await call(pool)).used[0], KEYS[0]);
});

test("a short cooldown never cuts a longer one short", async () => {
  const { pool, clock } = makePool(2);
  const a = heldCall(pool, KEYS[0]);
  const b = heldCall(pool, KEYS[0]);
  const start = clock.t;
  a.release({ status: 402 });
  await a.done;
  b.release({ status: 429, retryAfterSec: 5 });
  await b.done;
  clock.t = start + 3599 * SEC;
  assert.equal((await call(pool)).used[0], KEYS[1]);
  clock.t = start + 3600 * SEC;
  assert.equal((await call(pool)).used[0], KEYS[0]);
});

test("a disabled key keeps its 401 reason when a concurrent call reports 429", async () => {
  const { pool } = makePool(2);
  const fail = (key) => (key === KEYS[1] ? { status: 401 } : undefined);
  const a = heldCall(pool, KEYS[0], fail);
  const b = heldCall(pool, KEYS[0], fail);
  a.release({ status: 401 });
  await a.done;
  b.release({ status: 429 });
  const error = await b.done;
  assert.match(error.message, /2 of 2 disabled \(#1 HTTP 401, #2 HTTP 401\)/);
});

test("keys benched with Retry-After: 0 still count as cooling in the summary", async () => {
  const { pool } = makePool(2);
  const { error } = await call(pool, () => ({ status: 429, retryAfterSec: 0 }));
  assert.match(error.message, /0 of 2 disabled, 2 cooling down/);
  assert.match(error.message, /earliest retry in 0s/);
});

test("redact masks a key whole even when another key is its prefix", () => {
  const pool = new KeyPool("Test", ["fc-dev", "fc-dev-2"], "sequential");
  assert.equal(pool.redact("bad fc-dev-2 and fc-dev"), "bad [key #2] and [key #1]");
});

test("redact replaces key text with the slot number", () => {
  const { pool } = makePool(2);
  const text = pool.redact(`bad ${KEYS[0]} and ${KEYS[1]}`);
  assert.equal(text, "bad [key #1] and [key #2]");
});

test("parseRetryAfter reads seconds only", () => {
  assert.equal(parseRetryAfter("120"), 120);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter(""), undefined);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"), undefined);
  assert.equal(parseRetryAfter(undefined), undefined);
});
