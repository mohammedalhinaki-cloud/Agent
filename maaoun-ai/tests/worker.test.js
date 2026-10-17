import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const api = (path, body, origin = "https://ai.maaoun.com") =>
  new Request("https://ai.maaoun.com" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body)
  });
const key = { provider: "openai", key: "sk-example-not-real" };
test("invalid provider fails validation", async () => {
  const response = await worker.fetch(api("/api/models", { ...key, provider: "unknown" }), {});
  assert.equal(response.status, 400);
});
test("cross-origin requests are rejected", async () => {
  const response = await worker.fetch(api("/api/models", key, "https://malicious.example"), {});
  assert.equal(response.status, 403);
});
test("models proxy returns parsed models", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(init.headers.authorization, "Bearer " + key.key);
    return new Response(JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(api("/api/models", key), {});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).models, ["gpt-4.1-mini"]);
  } finally { globalThis.fetch = oldFetch; }
});
test("chat API streams AI messages", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(JSON.parse(init.body).model, "gpt-4.1-mini");
    return new Response('data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\ndata: [DONE]\n\n', {
      status: 200, headers: { "content-type": "text/event-stream" }
    });
  };
  try {
    const response = await worker.fetch(api("/api/chat", { ...key, model: "gpt-4.1-mini", messages: [{ role: "user", content: "Hi" }] }), {});
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Hello!/);
    assert.match(body, /"done":true/);
  } finally { globalThis.fetch = oldFetch; }
});
test("static assets use security headers", async () => {
  const response = await worker.fetch(new Request("https://ai.maaoun.com/"), {
    ASSETS: { fetch: async () => new Response("<html>ok</html>", { headers: { "content-type": "text/html" } }) }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
});
