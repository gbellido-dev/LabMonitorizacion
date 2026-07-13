import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the digital foundry simulator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Ferrovia — Digital Foundry<\/title>/i);
  assert.match(html, /Fundición de hierro/);
  assert.match(html, /PLANTA 3D/);
  assert.match(html, /S7 GATEWAY/);
  assert.match(html, /FE-260713-084/);
  assert.match(html, /INYECTAR FALLO/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
