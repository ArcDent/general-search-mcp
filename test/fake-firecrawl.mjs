// A local stand-in for the Firecrawl API, reached through FIRECRAWL_API_URL.
// Each test sets a route that decides the reply from the method, path and
// Authorization header; every request is recorded.
import http from "node:http";

export const JOB_ID = "job-123";

export const replies = {
  scraped: { status: 200, body: { success: true, data: { markdown: "# hello", metadata: { title: "Hello", sourceURL: "https://example.com" } } } },
  crawlStarted: { status: 200, body: { success: true, id: JOB_ID, url: `https://api.example/v2/crawl/${JOB_ID}` } },
  crawlDone: { status: 200, body: { success: true, status: "completed", completed: 1, total: 1, data: [{ markdown: "page", metadata: { sourceURL: "https://example.com" } }] } },
  paymentRequired: { status: 402, body: { success: false, error: "Payment required" } },
  rateLimited: { status: 429, body: { success: false, error: "Rate limit exceeded" } },
};

export async function startFakeFirecrawl() {
  /** Requests since the last setRoute. */
  const requests = [];
  /** Every Authorization header seen, never cleared. */
  const allAuth = [];
  let route = () => ({ status: 404, body: { success: false, error: "no route" } });

  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const entry = { method: req.method, path: req.url, auth: req.headers.authorization };
      requests.push(entry);
      allAuth.push(entry.auth);
      const { status, body } = route(entry);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    allAuth,
    setRoute(fn) {
      route = fn;
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
