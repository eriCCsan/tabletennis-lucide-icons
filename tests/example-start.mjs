import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

export function waitForExample(child, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let log = "";
    let probing = false;
    let settled = false;
    let lastProbe = "No local URL received";
    const timer = setTimeout(
      () => finish(new Error(`Example startup timed out (${lastProbe}):\n${log}`)),
      timeout,
    );
    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      child.stdout.off("data", receive);
      child.stderr.off("data", receive);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve(url);
    }
    async function probe(url) {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
          });
          await response.body?.cancel();
          lastProbe = `HTTP ${response.status} at ${url}`;
          if (response.ok) return finish(null, url);
        } catch (error) {
          lastProbe = `${url}: ${error.message}`;
        }
        try {
          await delay(50, undefined, { signal: controller.signal });
        } catch {
          return;
        }
      }
    }
    function receive(data) {
      log += data;
      // Vite styles the port separately; chunks may split ANSI sequences or the URL.
      const url = stripVTControlCharacters(log).match(
        /http:\/\/127\.0\.0\.1:\d+(?:\/|(?=\s))/,
      )?.[0];
      if (url && !probing) {
        probing = true;
        void probe(url);
      }
    }
    function onError(error) {
      finish(error);
    }
    function onClose(code, signal) {
      finish(new Error(`Example exited (${signal ?? code}):\n${log}`));
    }
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", onError);
    child.once("close", onClose);
  });
}
