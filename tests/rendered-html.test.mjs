import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the knowledge network product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>知识网络/);
  assert.match(html, /将鼠标停在中心点约 0\.2 秒/);
  assert.match(html, /2D 力导向/);
  assert.match(html, /中心笔记/);
  assert.match(html, /等待扩散/);
  assert.match(html, /演示样本/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
