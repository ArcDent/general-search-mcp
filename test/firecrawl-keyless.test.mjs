// Crawl Layer with only a self-hosted FIRECRAWL_API_URL and no key. Kept in
// its own file because config.ts reads the environment once per process.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { replies, startFakeFirecrawl } from "./fake-firecrawl.mjs";

const fake = await startFakeFirecrawl();
after(() => fake.close());

// Only separators: parses to no key, while the raw value stays in the
// environment where the SDK would read it if apiKey were not passed.
process.env.FIRECRAWL_API_KEY = " , ";
process.env.FIRECRAWL_API_URL = fake.url;

const { crawlHandlers } = await import("../build/crawl/firecrawl.js");

test("scrape works without a key and sends no Authorization header", async () => {
  fake.setRoute(() => replies.scraped);
  const result = await crawlHandlers.scrape({ url: "https://example.com" });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /hello/);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].auth, undefined);
});
