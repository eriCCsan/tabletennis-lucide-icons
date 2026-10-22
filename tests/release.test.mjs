import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import release, { Config } from "release-it";
import {
  command,
  parseArguments,
  ReleaseSession,
  registry,
  repositoryName,
  runRelease,
} from "../scripts/release.mjs";
import { configureSession, releaseOptions } from "../scripts/release-plugin.mjs";

const root = new URL("../", import.meta.url).pathname;
const digest = (data) => createHash("sha256").update(data).digest("hex");
const sri = (data) => `sha512-${createHash("sha512").update(data).digest("base64")}`;

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "icons-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = async (args) => (await command("git", args, { cwd: dir })).stdout.trim();
  const pkg = {
    name: "tabletennis-lucide-icons",
    version: "0.1.0",
    type: "module",
    files: ["dist"],
    repository: {
      type: "git",
      url: "git+https://github.com/eriCCsan/tabletennis-lucide-icons.git",
    },
    scripts: { build: "node build.mjs" },
  };
  await writeFile(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(
    join(dir, "package-lock.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: pkg.name, version: pkg.version } },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(dir, ".gitignore"), "node_modules\ndist/\nartifacts/\n");
  await writeFile(
    join(dir, "build.mjs"),
    `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { execFileSync } from "node:child_process";
    mkdirSync("dist", {recursive: true});
    mkdirSync("artifacts", {recursive: true});
    writeFileSync("dist/index.js", "export const value = 1;\\n");
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", "artifacts"], {stdio: "pipe"});
  `,
  );
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Local release test"]);
  await git(["config", "user.email", "release-test@example.invalid"]);
  await git(["add", "."]);
  await git(["commit", "-m", "chore: initial fixture"]);
  await git([
    "remote",
    "add",
    "origin",
    "https://github.com/eriCCsan/tabletennis-lucide-icons.git",
  ]);
  const base = await git(["rev-parse", "HEAD"]);
  await git(["update-ref", "refs/remotes/origin/main", base]);
  await git(["config", "branch.main.remote", "origin"]);
  await git(["config", "branch.main.merge", "refs/heads/main"]);
  await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  return { dir, git, pkg, base };
}

async function harness(t, { dryRun = false } = {}) {
  const f = await fixture(t);
  const network = {
    remoteHead: f.base,
    remoteTag: null,
    published: null,
    githubRelease: null,
    publishes: 0,
    pushes: 0,
    posts: 0,
    fail: null,
    prompts: [],
    logs: [],
  };
  const response = (body, status = 200) => ({
    code: status >= 400 ? 1 : 0,
    stdout: `HTTP/2 ${status} Test\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(body)}`,
  });
  const exec = async (name, inputArgs, options) => {
    let args = [...inputArgs];
    if (name === "git") {
      while (args[0] === "-c") args = args.slice(2);
      if (["fetch", "push", "ls-remote"].includes(args[0])) {
        if (network.fail === args[0]) throw new Error("Simulated network failure");
        if (args[0] === "fetch") {
          await f.git(["update-ref", "refs/remotes/origin/main", network.remoteHead]);
        } else if (args[0] === "push") {
          assert(args.includes("--atomic"));
          assert(!args.some((a) => a.includes("force")));
          network.pushes++;
          network.remoteHead = await f.git(["rev-parse", "HEAD"]);
          network.tagName = args.find((a) => a.startsWith("refs/tags/")).split(":")[0];
          network.remoteTag = await f.git(["rev-parse", network.tagName]);
        } else {
          return {
            code: 0,
            stdout:
              `${network.remoteHead}\trefs/heads/main\n` +
              (network.remoteTag
                ? `${network.remoteTag}\t${network.tagName}\n${network.remoteHead}\t${network.tagName}^{}\n`
                : ""),
          };
        }
        return { code: 0, stdout: "" };
      }
      assert(!args.includes("reset") && !args.includes("--delete"), "No rollback commands");
      return command(name, args, options);
    }
    if (name === "gh") {
      if (network.fail === "gh") throw new Error("Simulated unavailable gh");
      if (args[0] === "auth") return { code: 0, stdout: "" };
      const path = args[4];
      if (path === "repos/eriCCsan/tabletennis-lucide-icons")
        return response({ permissions: { push: true } });
      if (path.endsWith("rules/branches/main")) return response(network.rules ?? []);
      if (path.endsWith("/protection")) return response({}, 404);
      if (args.includes("POST")) {
        if (network.fail === "github-create") throw new Error("Simulated GitHub failure");
        network.posts++;
        network.githubRelease = { ...JSON.parse(options.input), id: 42 };
        return response(network.githubRelease);
      }
      return network.githubRelease && path.endsWith(`/tags/${network.githubRelease.tag_name}`)
        ? response(network.githubRelease)
        : response({}, 404);
    }
    if (name === "npm") {
      if (args[0] === "publish") {
        assert.equal(options.interactive, true);
        assert(!args.some((a) => a.startsWith("--otp")));
        network.publishes++;
        const s = JSON.parse(
          await readFile(join(f.dir, ".git/tabletennis-release/state.json"), "utf8"),
        );
        if (network.fail === "publish-before") throw new Error("Simulated rejected publish");
        network.published = { name: s.name, version: s.version, dist: { integrity: s.integrity } };
        if (network.fail === "publish-after")
          throw new Error("Simulated response loss after publish");
        return { code: 0, stdout: "" };
      }
      if (args[0] === "whoami") return { code: 0, stdout: "fixture-user\n" };
      if (args[0] === "config") return { code: 0, stdout: registry };
      if (args[0] === "profile")
        return {
          code: 0,
          stdout: JSON.stringify({ tfa: { mode: network.tfa ?? "auth-and-writes" } }),
        };
      if (args[0] === "access") return { code: 0, stdout: '{"fixture-user":"read-write"}' };
    }
    return command(name, args, options);
  };
  const request = async (url) => {
    if (network.fail === "registry") throw new Error("Simulated registry outage");
    const singleVersion = new URL(url).pathname.split("/").length > 2;
    const requestedVersion = new URL(url).pathname.split("/")[2];
    const body =
      network.published && (!singleVersion || requestedVersion === network.published.version)
        ? singleVersion
          ? network.published
          : {
              versions: { [network.published.version]: network.published },
              "dist-tags": { latest: network.published.version },
            }
        : null;
    return { status: body ? 200 : 404, ok: Boolean(body), json: async () => body };
  };
  const session = () =>
    new ReleaseSession({
      root: f.dir,
      dryRun,
      exec,
      request,
      tty: true,
      ci: false,
      ask: async (message) => {
        network.prompts.push(message);
        return network.answer !== false;
      },
      log: (message) => network.logs.push(message),
    });
  const fastPrepare = async (s) => {
    s.prepare = async (version) => {
      const proposed = {};
      for (const file of ["package.json", "package-lock.json"]) {
        const text = await readFile(join(f.dir, file), "utf8");
        const data = JSON.parse(text);
        data.version = version;
        if (file === "package-lock.json") data.packages[""].version = version;
        proposed[file] = { before: digest(text), content: `${JSON.stringify(data, null, 2)}\n` };
      }
      s.prepared = true;
      const tarball = Buffer.from("isolated simulated archive");
      return { tarball, integrity: sri(tarball), manifests: proposed };
    };
  };
  return { ...f, network, session, fastPrepare };
}

test("release configuration disables all built-in writers and CLI overrides", async () => {
  const config = new Config(releaseOptions({ dryRun: true }));
  await config.init();
  for (const name of ["git", "npm", "github", "gitlab"]) assert.equal(config.options[name], false);
  assert.equal(config.isDryRun, true);
  assert.equal(config.isCI, false);
  assert.equal(config.options.plugins["@release-it/conventional-changelog"].infile, false);
  assert.deepEqual(parseArguments([]), { dryRun: false });
  assert.deepEqual(parseArguments(["--dry-run"]), { dryRun: true });
  for (const args of [["--ci"], ["--yes"], ["patch"], ["--dry-run", "--ci"]])
    assert.throws(() => parseArguments(args));
  assert.equal(
    repositoryName("git@github.com:eriCCsan/tabletennis-lucide-icons.git"),
    "eriCCsan/tabletennis-lucide-icons",
  );
  assert.throws(() => repositoryName("https://user:credential@github.com/owner/repo.git"));
});

for (const [message, expected] of [
  ["fix: correct icon", "0.1.1"],
  ["feat: add icon", "0.2.0"],
  ["feat!: change API", "1.0.0"],
  ["fix: update API\n\nBREAKING CHANGE: remove old prop", "1.0.0"],
  ["chore!: remove compatibility", "1.0.0"],
  ["docs: clarify setup", null],
]) {
  test(`official plugin computes ${expected ?? "no release"} for ${message.split("\n")[0]}`, async (t) => {
    const f = await fixture(t);
    await f.git(["tag", "--annotate", "v0.1.0", "-m", "initial"]);
    await f.git(["commit", "--allow-empty", "-m", message]);
    const cwd = process.cwd();
    let observed = null;
    try {
      process.chdir(f.dir);
      configureSession({
        pkg: f.pkg,
        repo: "eriCCsan/tabletennis-lucide-icons",
        latestTag: "v0.1.0",
        perform: async (version, notes) => {
          observed = version;
          assert(notes);
        },
      });
      await release({ ...releaseOptions({ dryRun: true }), quiet: true });
    } finally {
      configureSession(null);
      process.chdir(cwd);
    }
    assert.equal(observed, expected);
  });
}

test("first release retains manifest version even with breaking commits", async (t) => {
  const f = await fixture(t);
  await f.git(["commit", "--allow-empty", "-m", "feat!: initial API"]);
  const cwd = process.cwd();
  let observed;
  try {
    process.chdir(f.dir);
    configureSession({
      pkg: f.pkg,
      repo: "eriCCsan/tabletennis-lucide-icons",
      perform: async (v) => {
        observed = v;
      },
    });
    await release({ ...releaseOptions({ initial: true, dryRun: true }), quiet: true });
  } finally {
    configureSession(null);
    process.chdir(cwd);
  }
  assert.equal(observed, "0.1.0");
  assert.equal((await readFile(join(f.dir, "package.json"), "utf8")).includes('"0.1.0"'), true);
});

test("real candidate preparation builds and packs an isolated copy without changing source", async (t) => {
  const h = await harness(t, { dryRun: true });
  const s = h.session();
  await s.initialize();
  const before = await readFile(join(h.dir, "package.json"), "utf8");
  const candidate = await s.prepare("0.2.0");
  assert.equal(JSON.parse(candidate.manifests["package.json"].content).version, "0.2.0");
  assert.equal(
    JSON.parse(candidate.manifests["package-lock.json"].content).packages[""].version,
    "0.2.0",
  );
  assert.equal(await readFile(join(h.dir, "package.json"), "utf8"), before);
  assert.equal(await h.git(["status", "--porcelain"]), "");
  assert.equal(await h.git(["tag", "--list"]), "");
  assert.equal(h.network.publishes + h.network.pushes + h.network.posts, 0);
});

test("dry-run performs local preparation despite missing remote checks and never writes state", async (t) => {
  const h = await harness(t, { dryRun: true });
  h.network.fail = "ls-remote";
  const s = h.session();
  await s.initialize();
  await h.fastPrepare(s);
  await s.perform("0.1.0", "Initial release.");
  assert(s.issues.some((i) => i.includes("origin")));
  assert(s.prepared);
  await assert.rejects(readFile(join(s.stateDir, "state.json")), { code: "ENOENT" });
  assert.equal(h.network.prompts.length, 0);
  assert.equal(h.network.publishes + h.network.pushes + h.network.posts, 0);
});

test("dry-run remote inspection does not update cached refs or import remote tags", async (t) => {
  const h = await harness(t, { dryRun: true });
  const refs = await h.git(["show-ref"]);
  h.network.remoteHead = "1".repeat(40);
  h.network.remoteTag = "2".repeat(40);
  h.network.tagName = "refs/tags/v9.0.0";
  const s = h.session();
  await s.initialize();
  assert(s.issues.some((i) => i.includes("origin")));
  assert.equal(await h.git(["show-ref"]), refs);
  assert.equal(await h.git(["tag", "--list"]), "");
});

test("full dry-run reports remote gaps after actual isolated build", async (t) => {
  const h = await harness(t, { dryRun: true });
  h.network.fail = "ls-remote";
  const options = h.session();
  const cwd = process.cwd();
  const before = await h.git(["show-ref"]);
  try {
    process.chdir(h.dir);
    await assert.rejects(runRelease(options), /local checks completed.*unverified/);
  } finally {
    process.chdir(cwd);
  }
  assert.equal(await h.git(["show-ref"]), before);
  assert.equal(await h.git(["status", "--porcelain"]), "");
  assert.equal(h.network.publishes + h.network.posts + h.network.pushes, 0);
  await assert.rejects(readFile(join(h.dir, ".git/tabletennis-release/state.json")), {
    code: "ENOENT",
  });
});

for (const failure of ["publish-before", "publish-after", "github-create", "push"]) {
  test(`resume after ${failure} preserves version/commit/tag and avoids duplicate publish`, async (t) => {
    const h = await harness(t);
    let s = h.session();
    await s.initialize();
    await s.acquire();
    await h.fastPrepare(s);
    h.network.fail = failure;
    await assert.rejects(s.perform("0.1.0", "Initial release."));
    await s.unlock();
    const commit = await h.git(["rev-parse", "HEAD"]);
    const tag = await h.git(["rev-parse", "refs/tags/v0.1.0"]);
    assert.equal(await h.git(["cat-file", "-t", tag]), "tag");
    assert.notEqual(commit, h.base);
    h.network.fail = null;
    s = h.session();
    await s.initialize();
    assert.equal(s.state.version, "0.1.0");
    await s.acquire();
    try {
      await s.perform("0.1.0", "ignored on resume");
    } finally {
      await s.unlock();
    }
    assert.equal(await h.git(["rev-parse", "HEAD"]), commit);
    assert.equal(await h.git(["rev-parse", "refs/tags/v0.1.0"]), tag);
    assert.equal(h.network.publishes, failure === "publish-before" ? 2 : 1);
    assert.equal(h.network.posts, 1);
    await assert.rejects(readFile(join(s.stateDir, "state.json")), { code: "ENOENT" });
  });
}

test("declining preparation or publication creates no commit/tag/push/publish", async (t) => {
  const h = await harness(t);
  const s = h.session();
  await s.initialize();
  await s.acquire();
  await h.fastPrepare(s);
  h.network.answer = false;
  try {
    await s.perform("0.1.0", "Initial release.");
  } finally {
    await s.unlock();
  }
  assert.equal(await h.git(["rev-parse", "HEAD"]), h.base);
  assert.equal(await h.git(["tag", "--list"]), "");
  assert.equal(h.network.publishes + h.network.pushes + h.network.posts, 0);
});

test("complete follow-up release uses plugin-calculated minor and subsequent run is a no-op", async (t) => {
  const h = await harness(t);
  const first = h.session();
  await first.initialize();
  await first.acquire();
  await h.fastPrepare(first);
  try {
    await first.perform("0.1.0", "Initial release.");
  } finally {
    await first.unlock();
  }
  await h.git(["commit", "--allow-empty", "-m", "fix: correct old icon"]);
  await h.git(["commit", "--allow-empty", "-m", "feat: add new icon"]);
  h.network.remoteHead = await h.git(["rev-parse", "HEAD"]);
  const cwd = process.cwd();
  try {
    process.chdir(h.dir);
    await runRelease(h.session());
    assert.equal(JSON.parse(await readFile(join(h.dir, "package.json"), "utf8")).version, "0.2.0");
    assert.equal(h.network.publishes, 2);
    assert.equal(h.network.posts, 2);
    assert.match(h.network.githubRelease.body, /add new icon/);
    const head = await h.git(["rev-parse", "HEAD"]);
    await runRelease(h.session());
    assert.equal(await h.git(["rev-parse", "HEAD"]), head);
    assert.equal(h.network.publishes, 2);
    assert.equal(h.network.posts, 2);
  } finally {
    process.chdir(cwd);
  }
});

test("declining final publication leaves only private recovery state", async (t) => {
  const h = await harness(t);
  const s = h.session();
  await s.initialize();
  await s.acquire();
  await h.fastPrepare(s);
  let prompts = 0;
  s.ask = async () => ++prompts === 1;
  try {
    await s.perform("0.1.0", "Initial release.");
  } finally {
    await s.unlock();
  }
  assert.equal(await h.git(["rev-parse", "HEAD"]), h.base);
  assert.equal(await h.git(["status", "--porcelain"]), "");
  assert.equal(await h.git(["tag", "--list"]), "");
  assert.equal(h.network.publishes + h.network.posts + h.network.pushes, 0);
  assert.equal(JSON.parse(await readFile(s.statePath, "utf8")).version, "0.1.0");
});

test("recovery rejects unrelated staged content even if the worktree was restored", async (t) => {
  const h = await harness(t);
  const s = h.session();
  await s.initialize();
  await s.acquire();
  await h.fastPrepare(s);
  let prompts = 0;
  s.ask = async () => ++prompts === 1;
  try {
    await s.perform("0.1.0", "Initial release.");
  } finally {
    await s.unlock();
  }
  const path = join(h.dir, "build.mjs");
  const before = await readFile(path, "utf8");
  await writeFile(path, `${before}\n// staged change\n`);
  await h.git(["add", "build.mjs"]);
  await writeFile(path, before);
  await assert.rejects(s.checkTree(), /Unrelated recovery changes/);
  assert.equal(h.network.publishes + h.network.posts + h.network.pushes, 0);
});

for (const condition of [
  "dirty",
  "branch",
  "upstream",
  "remote",
  "gh",
  "registry",
  "rules",
  "2fa",
  "non-tty",
  "ci",
]) {
  test(`preflight blocks ${condition} before any release mutation`, async (t) => {
    const h = await harness(t);
    const s = h.session();
    if (condition === "dirty") await writeFile(join(h.dir, "untracked.txt"), "not a secret");
    if (condition === "branch") await h.git(["checkout", "-b", "other"]);
    if (condition === "upstream") await h.git(["config", "--unset", "branch.main.merge"]);
    if (condition === "remote") h.network.remoteHead = "0".repeat(40);
    if (["gh", "registry"].includes(condition)) h.network.fail = condition;
    if (condition === "rules") h.network.rules = [{ type: "pull_request" }];
    if (condition === "2fa") h.network.tfa = "auth-only";
    if (condition === "non-tty") s.tty = false;
    if (condition === "ci") s.ci = true;
    await assert.rejects(s.initialize());
    assert.equal(h.network.publishes + h.network.pushes + h.network.posts, 0);
  });
}

test("recovery refuses modified files, corrupted archive and conflicting npm integrity", async (t) => {
  const h = await harness(t);
  const s = h.session();
  await s.initialize();
  await s.acquire();
  await h.fastPrepare(s);
  let asks = 0;
  s.ask = async () => ++asks === 1;
  await s.perform("0.1.0", "Initial release.");
  await s.unlock();
  const path = join(h.dir, "package.json");
  const original = await readFile(path, "utf8");
  await writeFile(path, original.replace('"0.1.0"', '"9.9.9"'));
  await assert.rejects(s.checkTree(), /modified externally/);
  await writeFile(path, original);
  h.network.published = { name: h.pkg.name, version: "0.1.0", dist: { integrity: "different" } };
  await assert.rejects(s.finish(), /integrity conflict/);
  h.network.published = null;
  await writeFile(join(s.stateDir, "package.tgz"), "corrupt");
  await assert.rejects(s.finish(), /tarball changed/);
  assert.equal(await h.git(["rev-parse", "HEAD"]), h.base);
});

test("parallel releases are locked without deleting another process lock", async (t) => {
  const h = await harness(t);
  const first = h.session();
  await first.initialize();
  await first.acquire();
  const second = h.session();
  await second.initialize();
  await assert.rejects(second.acquire(), /Another release/);
  assert.equal(await readFile(join(first.stateDir, "lock"), "utf8"), String(process.pid));
  await first.unlock();
});

test("command errors never echo subprocess output or supplied arguments", async () => {
  const marker = "synthetic-sensitive-marker-not-a-real-secret";
  await assert.rejects(
    command(process.execPath, ["-e", `console.error(${JSON.stringify(marker)}); process.exit(1)`]),
    (error) => {
      assert(!error.message.includes(marker));
      return true;
    },
  );
});
