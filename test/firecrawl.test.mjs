// Crawl Layer key rotation against a local fake Firecrawl, with two keys
// configured as one comma-separated FIRECRAWL_API_KEY.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JOB_ID, replies, startFakeFirecrawl } from "./fake-firecrawl.mjs";

const fake = await startFakeFirecrawl();
after(() => fake.close());

// Set before the build is imported: config.ts reads the environment once.
// Every variable is set, not deleted, so a local .env cannot fill it back in.
process.env.FIRECRAWL_API_KEY = "fc-key-one,fc-key-two";
process.env.FIRECRAWL_API_URL = fake.url;
process.env.KEY_ROTATION = "sequential";

const ONE = "Bearer fc-key-one";
const TWO = "Bearer fc-key-two";

// Each import with a new query string is a fresh module, so each test starts
// with a fresh key pool; the shared config stays the same.
let instance = 0;
const load = async () =>
  (await import(`../build/crawl/firecrawl.js?case=${++instance}`)).crawlHandlers;

test("scrape moves to key #2 when key #1 gets 402", async () => {
  const crawl = await load();
  fake.setRoute(({ auth }) => (auth === ONE ? replies.paymentRequired : replies.scraped));
  const result = await crawl.scrape({ url: "https://example.com" });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /hello/);
  assert.deepEqual(fake.requests.map((r) => r.auth), [ONE, TWO]);
});

test("crawl restarts under key #2 when starting with key #1 gets 429", async () => {
  const crawl = await load();
  fake.setRoute(({ method, auth }) => {
    if (method === "POST") return auth === ONE ? replies.rateLimited : replies.crawlStarted;
    return replies.crawlDone;
  });
  const result = await crawl.crawl({ url: "https://example.com", limit: 1 });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Crawl status: completed/);
  const starts = fake.requests.filter((r) => r.method === "POST");
  assert.deepEqual(starts.map((r) => r.auth), [ONE, TWO]);
});

test("crawl never starts a second job when polling gets 402", async () => {
  const crawl = await load();
  fake.setRoute(({ method }) => (method === "POST" ? replies.crawlStarted : replies.paymentRequired));
  const result = await crawl.crawl({ url: "https://example.com", limit: 1 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, new RegExp(JOB_ID));
  assert.equal(fake.requests.filter((r) => r.method === "POST").length, 1);

  // The 402 still benched key #1: the next request starts with key #2.
  fake.setRoute(() => replies.scraped);
  await crawl.scrape({ url: "https://example.com" });
  assert.equal(fake.requests[0].auth, TWO);
});

test("the raw comma-separated key list never reaches Firecrawl", () => {
  assert.ok(fake.allAuth.length > 0);
  assert.ok(!fake.allAuth.includes("Bearer fc-key-one,fc-key-two"));
  for (const auth of fake.allAuth) assert.ok(auth === ONE || auth === TWO, `unexpected ${auth}`);
});
