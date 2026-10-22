import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import { waitForExample } from "./example-start.mjs";

function childProcess(t) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  t.after(() => {
    child.stdout.destroy();
    child.stderr.destroy();
  });
  return child;
}

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    instance.closeAllConnections();
    await new Promise((resolve) => instance.close(resolve));
  });
  return `http://127.0.0.1:${instance.address().port}/`;
}

function assertClean(child) {
  for (const event of ["close", "error"]) assert.equal(child.listenerCount(event), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
}

test("readiness handles Vite ANSI output split across chunks and waits for HTTP success", async (t) => {
  let requests = 0;
  const url = await server(t, (_request, response) => {
    requests++;
    response.writeHead(requests === 1 ? 503 : 200).end("ready");
  });
  const child = childProcess(t);
  const ready = waitForExample(child);
  const [host, port] = url.split(/:(?=\d+\/)/);
  child.stdout.write(`Re-optimizing dependencies because vite config has changed\n`);
  child.stdout.write(`\x1b[36mLocal: ${host}:\x1b[`);
  child.stdout.write(`1m${port.slice(0, -1)}\x1b[22m/\x1b[39m\n`);
  assert.equal(await ready, url);
  assert.equal(requests, 2);
  assertClean(child);
});

test("readiness accepts the vanilla URL without a trailing slash on stderr", async (t) => {
  const url = (await server(t, (_request, response) => response.end("ready"))).slice(0, -1);
  const child = childProcess(t);
  const ready = waitForExample(child);
  child.stderr.write(`Vanilla example: ${url}\n`);
  assert.equal(await ready, url);
  assertClean(child);
});

test("readiness times out without a URL and releases listeners", async (t) => {
  const child = childProcess(t);
  await assert.rejects(waitForExample(child, { timeout: 25 }), /timed out.*No local URL/);
  assertClean(child);
});

test("a printed URL alone is not ready and a process exit cancels the HTTP probe", async (t) => {
  const child = childProcess(t);
  const url = await server(t, () => child.emit("close", 1, null));
  const ready = waitForExample(child);
  child.stdout.write(`Local: ${url}\n`);
  await assert.rejects(ready, /Example exited \(1\)/);
  assertClean(child);
});

test("readiness reports spawn errors immediately and releases listeners", async (t) => {
  const child = childProcess(t);
  const ready = waitForExample(child);
  child.emit("error", new Error("spawn ENOENT"));
  await assert.rejects(ready, /spawn ENOENT/);
  assertClean(child);
});
