import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
import {
  compareVersions,
  configureSession,
  nextVersion,
  recommend,
  releaseOptions,
} from "../scripts/release-plugin.mjs";

const root = new URL("../", import.meta.url).pathname;
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
    published: null,
    remoteHead: f.base,
    tags: new Map(),
    releases: new Map(),
    pushes: 0,
    publications: 0,
    waits: 0,
    reads: 0,
    fail: null,
    logs: [],
  };
  const response = (data, code = 200) => ({
    code: code >= 400 ? 1 : 0,
    stdout: `HTTP/2 ${code} Test\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(data)}`,
  });
  const exec = async (name, input, options) => {
    let args = [...input];
    if (name === "git") {
      while (args[0] === "-c") args = args.slice(2);
      assert(!args.includes("--force") && !args.includes("reset") && !args.includes("--delete"));
      if (args[0] === "fetch") {
        await f.git(["update-ref", "refs/remotes/origin/main", network.remoteHead]);
        return { code: 0, stdout: "" };
      }
      if (args[0] === "push") {
        assert(args.includes("--atomic"));
        if (network.fail === "push") throw new Error("push failed");
        network.pushes++;
        network.remoteHead = await f.git(["rev-parse", "HEAD"]);
        const tag = args.find((arg) => arg.startsWith("refs/tags/")).split(":")[0];
        network.tags.set(tag, {
          object: await f.git(["rev-parse", tag]),
          commit: network.remoteHead,
        });
        return { code: 0, stdout: "" };
      }
      if (args[0] === "ls-remote")
        return {
          code: 0,
          stdout:
            `${network.remoteHead}\trefs/heads/main\n` +
            [...network.tags]
              .map(([ref, value]) => `${value.object}\t${ref}\n${value.commit}\t${ref}^{}\n`)
              .join(""),
        };
      return command(name, args, options);
    }
    if (name === "gh") {
      if (network.fail === "auth") throw new Error("auth failed");
      if (args[0] === "auth") return { code: 0, stdout: "" };
      const path = args[4];
      if (path === "repos/eriCCsan/tabletennis-lucide-icons")
        return response({ permissions: { push: true } });
      if (path.endsWith("/rules/branches/main")) return response(network.rules ?? []);
      if (path.endsWith("/protection")) return response({}, 404);
      if (path.includes("/releases/tags/")) {
        const found = network.releases.get(path.split("/").at(-1));
        return response(found ?? {}, found ? 200 : 404);
      }
      if (path === "repos/eriCCsan/tabletennis-lucide-icons/releases" && args.includes("POST")) {
        if (network.fail === "github") throw new Error("github release failed");
        const data = JSON.parse(options.input);
        assert.equal(network.published?.version, data.tag_name.slice(1));
        network.releases.set(data.tag_name, { ...data, id: 42 });
        return response({ ...data, id: 42 }, 201);
      }
      assert.fail(`Unexpected gh command: ${args.slice(0, 5).join(" ")}`);
    }
    if (name === "npm") {
      if (args[0] === "config") return { code: 0, stdout: registry };
      if (args[0] === "whoami") {
        if (network.fail === "npm auth") throw new Error("npm login required");
        return { code: 0, stdout: "fixture-user" };
      }
      if (args[0] === "access")
        return {
          code: 0,
          stdout: JSON.stringify({ "fixture-user": network.permission ?? "read-write" }),
        };
      if (args[0] === "publish") {
        if (network.fail === "npm before") throw new Error("npm rejected before upload");
        assert.equal(options.interactive, true);
        assert(args.includes("--ignore-scripts") && args.includes("--provenance=false"));
        const state = JSON.parse(
          await readFile(join(f.dir, ".git/tabletennis-release/state.json")),
        );
        assert.equal(
          state.npmPublishAccepted,
          null,
          "Persist uncertainty before the network write",
        );
        network.publications++;
        network.published = {
          name: f.pkg.name,
          version: state.version,
          dist: { integrity: state.integrity },
        };
        if (network.fail === "npm after") throw new Error("Connection lost after upload");
        return { code: 0, stdout: "" };
      }
      assert(!["login", "profile"].includes(args[0]), "No account changes");
    }
    return command(name, args, options);
  };
  const request = async (url) => {
    const version = decodeURIComponent(new URL(url).pathname).split("/")[2];
    let value = network.published;
    if (version && value?.version === version) {
      network.reads++;
      if (network.delay && network.reads <= network.delay) value = null;
      if (value && network.conflict) value = { ...value, dist: { integrity: "conflict" } };
    }
    const data = version
      ? value?.version === version
        ? value
        : null
      : value
        ? { "dist-tags": { latest: value.version }, versions: { [value.version]: value } }
        : null;
    return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data };
  };
  const options = () => ({
    root: f.dir,
    dryRun,
    exec,
    request,
    pause: async () => {
      network.waits++;
    },
    tty: true,
    ci: false,
    log: (message) => network.logs.push(message),
  });
  const baseline = async () => {
    await f.git(["tag", "--annotate", "v0.1.0", "-m", "published"]);
    network.tags.set("refs/tags/v0.1.0", {
      object: await f.git(["rev-parse", "v0.1.0"]),
      commit: f.base,
    });
    network.published = { name: f.pkg.name, version: "0.1.0" };
    network.releases.set("v0.1.0", { tag_name: "v0.1.0", draft: false, prerelease: false });
  };
  const change = async (message, { file = "scripts-tool.mjs", version } = {}) => {
    if (file === "scripts-tool.mjs") file = "package.json";
    if (file === "package.json") {
      const pkg = JSON.parse(await readFile(join(f.dir, file), "utf8"));
      if (version) {
        pkg.version = version;
        const path = join(f.dir, "package-lock.json");
        const lock = JSON.parse(await readFile(path, "utf8"));
        lock.version = version;
        lock.packages[""].version = version;
        await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
      } else pkg.description = message;
      await writeFile(join(f.dir, file), `${JSON.stringify(pkg, null, 2)}\n`);
    } else await writeFile(join(f.dir, file), message);
    await f.git(["add", "."]);
    await f.git(["commit", "-m", message]);
    network.remoteHead = await f.git(["rev-parse", "HEAD"]);
  };
  const session = () => {
    const s = new ReleaseSession(options());
    s.prepare = async (version) => {
      const manifests = {};
      for (const file of ["package.json", "package-lock.json"]) {
        const source = await readFile(join(f.dir, file), "utf8");
        const data = JSON.parse(source);
        data.version = version;
        if (data.packages) data.packages[""].version = version;
        manifests[file] = {
          before: createHash("sha256").update(source).digest("hex"),
          content: `${JSON.stringify(data, null, 2)}\n`,
        };
      }
      const tarball = Buffer.from("simulated checked archive");
      s.prepared = true;
      return { manifests, tarball, integrity: sri(tarball) };
    };
    return s;
  };
  return { ...f, network, options, baseline, change, session };
}

async function executeRelease(session) {
  const previous = process.cwd();
  try {
    process.chdir(session.root);
    await session.initialize();
    if (!session.dryRun) await session.acquire();
    if (!session.state && !session.initial && !session.changes.length) return session;
    configureSession(session);
    await release(
      releaseOptions({
        initial: session.initial,
        resume: Boolean(session.state),
        pendingVersion: session.pendingVersion,
        dryRun: session.dryRun,
      }),
    );
    return session;
  } finally {
    process.chdir(previous);
    configureSession(null);
    await session.unlock();
  }
}

test("release options are noninteractive, disable all built-in writers and reject unsafe overrides", async () => {
  const config = new Config(releaseOptions({ dryRun: true }));
  await config.init();
  for (const name of ["git", "npm", "github", "gitlab"]) assert.equal(config.options[name], false);
  assert.equal(config.isDryRun, true);
  assert.equal(config.isCI, true);
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

for (const [message, expected, file] of [
  ["fix: correct icon", "0.1.1"],
  ["feat: add icon", "0.2.0"],
  ["feat!: change API", "1.0.0"],
  ["fix: update API\n\nBREAKING CHANGE: remove old prop", "1.0.0"],
  ["chore!: remove compatibility", "1.0.0"],
  ["Improve release tooling", "0.1.1"],
  ["docs: clarify setup", null, "README.md"],
  ["test: improve assertions", null, "test.txt"],
]) {
  test(`official plugin/relevance computes ${expected ?? "no release"} for ${message.split("\n")[0]}`, async (t) => {
    const h = await harness(t, { dryRun: true });
    await h.baseline();
    await h.change(message, { file });
    const before = await h.git(["rev-parse", "HEAD"]);
    const s = h.session();
    let observed = null;
    s.prepare = async (version) => {
      observed = version;
      s.prepared = true;
    };
    await executeRelease(s);
    assert.equal(observed, expected);
    if (expected) assert(h.network.logs.some((line) => line.includes(message.split("\n")[0])));
    assert.equal(await h.git(["rev-parse", "HEAD"]), before);
    assert.equal(h.network.pushes + h.network.publications, 0);
    await assert.rejects(readFile(s.statePath), { code: "ENOENT" });
  });
}

test("initial release retains the unpublished manifest version even with breaking commits", async (t) => {
  const h = await harness(t, { dryRun: true });
  await h.change("feat!: initial API");
  const s = h.session();
  let version;
  s.prepare = async (value) => {
    version = value;
  };
  await executeRelease(s);
  assert.equal(version, "0.1.0");
});

test("manual version must meet recommendation and is never bumped twice", async (t) => {
  for (const [prepared, expected] of [
    ["0.1.1", false],
    ["0.2.0", true],
    ["1.0.0", true],
  ]) {
    const h = await harness(t, { dryRun: true });
    await h.baseline();
    await h.change("feat: add icon");
    await h.change("chore: prepare version", { version: prepared });
    const s = h.session();
    let version;
    s.prepare = async (value) => {
      version = value;
    };
    if (expected) {
      await executeRelease(s);
      assert.equal(version, prepared);
    } else await assert.rejects(executeRelease(s), /lower than/);
  }
});

test("version-only change produces no release", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("chore: prepare version", { version: "0.1.1" });
  const s = h.session();
  await executeRelease(s);
  assert.equal(s.changes.length, 0);
  assert.equal(h.network.pushes, 0);
});

test("real candidate build and pack use isolated synchronized manifests, preserving originals", async (t) => {
  const h = await harness(t, { dryRun: true });
  const before = await readFile(join(h.dir, "package.json"), "utf8");
  const s = h.session();
  await s.initialize();
  const candidate = await ReleaseSession.prototype.prepare.call(s, "0.1.1");
  assert.equal(JSON.parse(candidate.manifests["package.json"].content).version, "0.1.1");
  assert.equal(
    JSON.parse(candidate.manifests["package-lock.json"].content).packages[""].version,
    "0.1.1",
  );
  assert.equal(candidate.integrity, sri(candidate.tarball));
  assert.equal(await readFile(join(h.dir, "package.json"), "utf8"), before);
  await assert.rejects(readFile(join(h.dir, "dist/index.js")), { code: "ENOENT" });
});

for (const failure of ["push", "github"]) {
  test(`interrupted ${failure} resumes same version/tag without duplicate publication`, async (t) => {
    const h = await harness(t);
    await h.baseline();
    await h.change("fix: correct package");
    h.network.fail = failure;
    await assert.rejects(executeRelease(h.session()), new RegExp(failure));
    const head = await h.git(["rev-parse", "HEAD"]);
    assert.equal(await h.git(["cat-file", "-t", "v0.1.1"]), "tag");
    h.network.fail = null;
    await executeRelease(h.session());
    assert.equal(await h.git(["rev-parse", "HEAD"]), head);
    assert.equal(h.network.publications, 1);
    await executeRelease(h.session());
    assert.equal(h.network.publications, 1);
  });
}

test("recovery rejects externally modified or unrelated staged files", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("fix: update");
  h.network.fail = "github";
  await assert.rejects(executeRelease(h.session()));
  const path = join(h.dir, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));
  pkg.description = "unauthorized recovery edit";
  await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(h.session().initialize(), /Working directory/);
});

for (const condition of [
  "branch",
  "dirty",
  "remote",
  "auth",
  "npm auth",
  "npm permission",
  "rules",
  "lock version",
  "old version",
]) {
  test(`preflight blocks ${condition} without publication`, async (t) => {
    const h = await harness(t);
    await h.baseline();
    if (condition === "branch") await h.git(["switch", "-c", "feature"]);
    if (condition === "dirty") await writeFile(join(h.dir, "dirty.txt"), "untracked");
    if (condition === "remote") h.network.remoteHead = "a".repeat(40);
    if (condition === "auth") h.network.fail = "auth";
    if (condition === "npm auth") h.network.fail = "npm auth";
    if (condition === "npm permission") h.network.permission = "read-only";
    if (condition === "rules") h.network.rules = [{ type: "pull_request" }];
    if (condition === "lock version") {
      const path = join(h.dir, "package-lock.json");
      const lock = JSON.parse(await readFile(path, "utf8"));
      lock.version = "0.0.1";
      await writeFile(path, JSON.stringify(lock));
      await h.git(["add", "."]);
      await h.git(["commit", "-m", "bad lock"]);
      h.network.remoteHead = await h.git(["rev-parse", "HEAD"]);
    }
    if (condition === "old version") await h.change("chore: bad version", { version: "0.0.9" });
    await assert.rejects(h.session().initialize());
    assert.equal(h.network.pushes + h.network.publications, 0);
  });
}

test("dry-run completes isolated build despite reported branch/dirty preconditions and changes no refs/state", async (t) => {
  const h = await harness(t, { dryRun: true });
  await h.baseline();
  await h.git(["switch", "-c", "feature"]);
  await writeFile(join(h.dir, "notes.txt"), "local edit");
  const refs = await h.git(["show-ref"]);
  const cwd = process.cwd();
  try {
    process.chdir(h.dir);
    await assert.rejects(runRelease(h.options()), /prerequisites/);
  } finally {
    process.chdir(cwd);
  }
  assert.equal(await h.git(["show-ref"]), refs);
  await assert.rejects(readFile(join(h.dir, ".git/tabletennis-release/state.json")), {
    code: "ENOENT",
  });
});

test("parallel local sessions cannot acquire or remove another session's lock", async (t) => {
  const h = await harness(t);
  const a = h.session();
  const b = h.session();
  await a.initialize();
  await b.initialize();
  await a.acquire();
  await assert.rejects(b.acquire(), /Another release/);
  await b.unlock();
  assert.equal(await readFile(join(a.stateDir, "lock"), "utf8"), String(process.pid));
  await a.unlock();
  await b.acquire();
  await b.unlock();
});

test("completed legacy recovery is recognized without rewriting an existing release or dry-run state", async (t) => {
  const h = await harness(t, { dryRun: true });
  await h.baseline();
  await h.change("fix: update");
  const s = h.session();
  await s.initialize();
  const candidate = await s.prepare("0.1.1");
  for (const [file, data] of Object.entries(candidate.manifests))
    await writeFile(join(h.dir, file), data.content);
  const base = await h.git(["rev-parse", "HEAD"]);
  await h.git(["add", "."]);
  await h.git(["commit", "-m", "chore: release v0.1.1"]);
  await h.git(["tag", "--annotate", "v0.1.1", "-m", "released"]);
  const commit = await h.git(["rev-parse", "HEAD"]);
  h.network.remoteHead = commit;
  h.network.tags.set("refs/tags/v0.1.1", { object: await h.git(["rev-parse", "v0.1.1"]), commit });
  h.network.published = {
    name: h.pkg.name,
    version: "0.1.1",
    dist: { integrity: candidate.integrity },
  };
  h.network.releases.set("v0.1.1", {
    tag_name: "v0.1.1",
    body: "Existing independently written notes",
    draft: false,
    prerelease: false,
  });
  await mkdir(s.stateDir, { recursive: true });
  const data = JSON.stringify({
    schema: 1,
    name: h.pkg.name,
    repo: s.repo,
    version: "0.1.1",
    base,
    commit,
    previousTag: "v0.1.0",
    notes: "different old notes",
    manifests: candidate.manifests,
    integrity: candidate.integrity,
  });
  await writeFile(s.statePath, data);
  const recovered = h.session();
  await recovered.initialize();
  assert.equal(recovered.state, null);
  assert.equal(recovered.completedLegacy, true);
  assert.equal(await readFile(s.statePath, "utf8"), data);
  assert.equal(h.network.releases.get("v0.1.1").body, "Existing independently written notes");
});

test("missing local recovery state cannot silently reconstruct a tagged npm package", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("fix: update");
  h.network.fail = "npm before";
  const failed = h.session();
  await assert.rejects(executeRelease(failed), /upload outcome is uncertain/);
  await rm(failed.statePath);
  await assert.rejects(h.session().initialize(), /without local recovery state/);
  assert.equal(h.network.publications, 0);
});

test("reverted library changes plus a version-only bump do not create a release", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("feat: temporary change");
  const pkg = { ...h.pkg, version: "0.1.1" };
  await writeFile(join(h.dir, "package.json"), JSON.stringify(pkg));
  const lock = JSON.parse(await readFile(join(h.dir, "package-lock.json"), "utf8"));
  lock.version = "0.1.1";
  lock.packages[""].version = "0.1.1";
  await writeFile(join(h.dir, "package-lock.json"), JSON.stringify(lock));
  await h.git(["add", "."]);
  await h.git(["commit", "-m", "chore: restore source and prepare version"]);
  h.network.remoteHead = await h.git(["rev-parse", "HEAD"]);
  const s = h.session();
  await s.initialize();
  assert.equal(s.changes.length, 0);
});

test("local npm upload waits for visibility and never submits a successful version twice", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("fix: update");
  h.network.delay = 3;
  await executeRelease(h.session());
  assert.equal(h.network.publications, 1);
  assert.equal(h.network.waits, 3);
  assert(h.network.releases.has("v0.1.1"));
  await executeRelease(h.session());
  assert.equal(h.network.publications, 1);
});

for (const failure of ["npm before", "npm after"]) {
  test(`uncertain local upload (${failure}) cannot be blindly resubmitted`, async (t) => {
    const h = await harness(t);
    await h.baseline();
    await h.change("fix: update");
    h.network.fail = failure;
    const failed = h.session();
    await assert.rejects(executeRelease(failed), /upload outcome is uncertain/);
    const state = JSON.parse(await readFile(failed.statePath));
    assert.equal(state.npmPublishAccepted, null);
    h.network.fail = null;
    if (failure === "npm before") {
      await assert.rejects(executeRelease(h.session()), /remains unavailable/);
      assert.equal(h.network.publications, 0);
      assert.equal(h.network.waits, 30);
    } else {
      await executeRelease(h.session());
      assert.equal(h.network.publications, 1);
      assert(h.network.releases.has("v0.1.1"));
    }
  });
}

test("corrupted local archive and conflicting npm integrity stop recovery", async (t) => {
  for (const condition of ["archive", "npm"]) {
    const h = await harness(t);
    await h.baseline();
    await h.change("fix: update");
    h.network.fail = "github";
    const failed = h.session();
    await assert.rejects(executeRelease(failed), /github release failed/);
    const publications = h.network.publications;
    h.network.fail = null;
    if (condition === "archive") await writeFile(join(failed.stateDir, "package.tgz"), "corrupt");
    else h.network.conflict = true;
    await assert.rejects(
      executeRelease(h.session()),
      condition === "archive" ? /tarball changed/ : /integrity conflict/,
    );
    assert.equal(h.network.publications, publications);
  }
});

test("real releases refuse CI and a new npm upload requires an interactive local terminal", async (t) => {
  const h = await harness(t);
  await h.baseline();
  await h.change("fix: update");
  const ci = h.session();
  ci.ci = true;
  await assert.rejects(ci.initialize(), /locally, not from CI/);
  const nonterminal = h.session();
  nonterminal.tty = false;
  await assert.rejects(executeRelease(nonterminal), /terminal/);
  assert.equal(h.network.publications, 0);
  const state = JSON.parse(await readFile(nonterminal.statePath));
  assert.equal(state.npmPublishAccepted, false);
});

test("version helpers handle large integers and relevant commit filtering", () => {
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  assert.equal(nextVersion("0.1.9", 1), "0.2.0");
  assert.equal(
    recommend([{ hash: "a", type: "feat", header: "feat: add", notes: [] }], new Set()),
    null,
  );
});

test("command errors suppress subprocess output and supplied arguments", async () => {
  await assert.rejects(
    command(process.execPath, ["-e", "console.error('private-value');process.exit(1)"]),
    (error) => !error.message.includes("private-value"),
  );
});
