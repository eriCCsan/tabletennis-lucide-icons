import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import release from "release-it";
import { configureSession, releaseOptions } from "./release-plugin.mjs";
import { packResult } from "./run.mjs";

export const registry = "https://registry.npmjs.org/";
const manifests = ["package.json", "package-lock.json"];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha = (data) => createHash("sha256").update(data).digest("hex");
const integrity = (data) => `sha512-${createHash("sha512").update(data).digest("base64")}`;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function json(data) {
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("Invalid JSON metadata/response; contents suppressed.");
  }
}

export function parseArguments(args) {
  requireCondition(
    args.length === 0 || (args.length === 1 && args[0] === "--dry-run"),
    "Only --dry-run is supported. No --ci, --yes or manual version overrides.",
  );
  return { dryRun: args.length === 1 };
}

export function repositoryName(url) {
  const match =
    /^(?:git\+)?https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url) ??
    /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  requireCondition(match, "Expected a credential-free GitHub repository URL.");
  return match[1];
}

export async function command(
  name,
  args,
  { cwd, input, interactive = false, allowFailure = false } = {},
) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(name, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"],
      timeout: interactive ? undefined : 120_000,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    // Never include subprocess stderr or authentication payloads in thrown/logged errors.
    child.stderr?.resume();
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
    child.on("error", () =>
      reject(new Error(`${name} unavailable; install it and check local authentication.`)),
    );
    child.on("close", (code) => {
      if (code === 0 || allowFailure) resolveResult({ code, stdout });
      else
        reject(
          new Error(
            `${name} failed (exit ${code}); check permissions, connectivity and local prerequisites.`,
          ),
        );
    });
  });
}

async function optionalJson(path) {
  try {
    return json(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}

export class ReleaseSession {
  constructor({
    root = process.cwd(),
    dryRun = false,
    exec = command,
    request = fetch,
    pause: wait = pause,
    log = console.log,
    ci = Boolean(process.env.CI),
    tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  } = {}) {
    Object.assign(this, { root: resolve(root), dryRun, exec, request, pause: wait, log, ci, tty });
    this.issues = [];
    this.prepared = false;
    this.githubAuthenticated = false;
  }

  async run(name, args, options = {}) {
    return this.exec(name, args, { cwd: this.root, ...options });
  }

  async git(args, options) {
    const credentials = this.githubAuthenticated
      ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]
      : [];
    return (await this.run("git", [...credentials, ...args], options)).stdout.trim();
  }

  async check(label, action) {
    try {
      return await action();
    } catch {
      this.issues.push(label);
      this.log(`NOT VERIFIED: ${label}`);
      if (!this.dryRun) throw new Error(label);
      return undefined;
    }
  }

  async github(path, { missing = false, body } = {}) {
    const args = ["api", "--hostname", "github.com", "--include", path];
    if (body) args.push("--method", "POST", "--input", "-");
    const result = await this.run("gh", args, {
      input: body ? JSON.stringify(body) : undefined,
      allowFailure: true,
    });
    const match = /^HTTP\/\S+ (\d+)[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/.exec(result.stdout);
    requireCondition(match, "GitHub response could not be verified.");
    const status = Number(match[1]);
    if (missing && status === 404) return null;
    requireCondition(
      result.code === 0 && status >= 200 && status < 300,
      "GitHub request failed; check access and repository rules.",
    );
    return json(match[2]);
  }

  async npmMetadata(version = "") {
    const url = `${registry}${encodeURIComponent(this.pkg.name)}${version ? `/${version}` : ""}`;
    const response = await this.request(url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (response.status === 404) return null;
    requireCondition(response.ok, "npm registry request failed; absence is not established.");
    return response.json();
  }

  async initialize() {
    requireCondition(!this.ci || this.dryRun, "Start real releases locally, not from CI.");
    this.pkg = json(await readFile(join(this.root, "package.json"), "utf8"));
    requireCondition(
      stableVersion.test(this.pkg.version) && !this.pkg.private,
      "Expected a public package with a stable version.",
    );
    requireCondition(this.pkg.name === "tabletennis-lucide-icons", "Unexpected package name.");
    const lock = json(await readFile(join(this.root, "package-lock.json"), "utf8"));
    requireCondition(
      lock.version === this.pkg.version && lock.packages?.[""]?.version === this.pkg.version,
      "Manifest and lockfile versions must match",
    );
    this.repo = repositoryName(this.pkg.repository.url);
    requireCondition(
      repositoryName(await this.git(["remote", "get-url", "origin"])) === this.repo,
      "Manifest repository and origin disagree.",
    );
    this.stateDir = await this.git([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "tabletennis-release",
    ]);
    this.statePath = join(this.stateDir, "state.json");
    this.state = await optionalJson(this.statePath);
    if (this.state) this.validateState();
    if (this.state && this.state.schema !== 3) {
      const published = await this.npmMetadata(this.state.version);
      const released = await this.github(
        `repos/${this.repo}/releases/tags/v${this.state.version}`,
        { missing: true },
      );
      requireCondition(
        published?.dist?.integrity === this.state.integrity &&
          released &&
          !released.draft &&
          !released.prerelease &&
          (await this.git(["rev-parse", `v${this.state.version}^{}`])) === this.state.commit,
        "Legacy release is incomplete or conflicting; verify the original npm upload and GitHub release before migrating.",
      );
      this.completedLegacy = true;
      this.state = null;
    }
    await this.check("Branch must be main", async () =>
      requireCondition((await this.git(["branch", "--show-current"])) === "main", "Wrong branch"),
    );
    await this.check(
      "Working directory/index must be clean (or exactly match recovery state)",
      () => this.checkTree(),
    );
    await this.check("GitHub CLI login required: install gh and run gh auth login", async () => {
      const status = await this.run("gh", ["auth", "status", "--hostname", "github.com"], {
        allowFailure: true,
      });
      requireCondition(status.code === 0, "GitHub authentication failed");
      this.githubAuthenticated = true;
    });
    await this.check("Current origin branches/tags and origin/main synchronization", () =>
      this.refresh(),
    );
    await this.check(
      "GitHub write access and branch protection must permit a direct release",
      async () => {
        const info = await this.github(`repos/${this.repo}`);
        requireCondition(info.permissions?.push, "No repository write access");
        const rules = await this.github(`repos/${this.repo}/rules/branches/main`);
        requireCondition(
          !rules.some((r) => ["pull_request", "required_status_checks", "update"].includes(r.type)),
          "Branch rules require a different human-reviewed workflow",
        );
        const protection = await this.github(`repos/${this.repo}/branches/main/protection`, {
          missing: true,
        });
        requireCondition(
          !protection?.required_pull_request_reviews && !protection?.required_status_checks,
          "Protected branch cannot be released directly",
        );
      },
    );
    this.metadata = await this.check("npm package existence/versions", () => this.npmMetadata());
    const allTags = (await this.git(["tag", "--list", "--sort=-v:refname"]))
      .split("\n")
      .filter(Boolean);
    const tags = allTags.filter((t) => t.startsWith("v") && stableVersion.test(t.slice(1)));
    this.latestTag = this.state?.previousTag ?? tags[0];
    this.initial = this.metadata === null && allTags.length === 0 && !this.state;
    if (
      !this.state &&
      this.latestTag &&
      this.metadata &&
      !this.metadata.versions?.[this.latestTag.slice(1)]
    )
      throw new Error(
        "Incomplete release tag without local recovery state/archive; investigate before rebuilding or publishing.",
      );
    if (!this.state)
      await this.check(
        "Release baseline must match npm/latest and its Git tag; a newer manifest must be unpublished",
        async () => {
          if (this.initial) {
            requireCondition(
              this.pkg.version === "0.1.0",
              "Unexpected unpublished initial version",
            );
            return;
          }
          const baseline = this.metadata?.["dist-tags"]?.latest;
          requireCondition(
            typeof baseline === "string" &&
              stableVersion.test(baseline) &&
              this.metadata.versions?.[baseline] &&
              this.latestTag === `v${baseline}`,
            "Published baseline is inconsistent; investigate manually",
          );
          await this.git(["merge-base", "--is-ancestor", this.latestTag, "HEAD"]);
          const tagged = json(await this.git(["show", `${this.latestTag}:package.json`]));
          const released = await this.github(`repos/${this.repo}/releases/tags/${this.latestTag}`, {
            missing: true,
          });
          requireCondition(
            released &&
              !released.draft &&
              !released.prerelease &&
              released.tag_name === this.latestTag,
            "Published baseline is missing its GitHub release; recover that release before creating a new version.",
          );
          requireCondition(
            tagged.name === this.pkg.name && tagged.version === baseline,
            "Tagged manifest does not match the published baseline",
          );
          const lock = json(await readFile(join(this.root, "package-lock.json"), "utf8"));
          requireCondition(
            lock.version === this.pkg.version && lock.packages?.[""]?.version === this.pkg.version,
            "Manifest and lockfile versions must match",
          );
          const current = this.pkg.version.split(".").map(BigInt);
          const previous = baseline.split(".").map(BigInt);
          const difference = current.findIndex((part, index) => part !== previous[index]);
          requireCondition(
            difference === -1 || current[difference] > previous[difference],
            "Manifest version is older than the published baseline",
          );
          this.baselineVersion = baseline;
          if (difference !== -1) {
            requireCondition(
              !this.metadata.versions[this.pkg.version],
              "Prepared manifest version already exists on npm",
            );
            this.pendingVersion = this.pkg.version;
            this.log(
              `Published baseline: ${baseline}; prepared release target: ${this.pendingVersion}.`,
            );
          }
        },
      );
    await this.check("Local npm authentication required: run npm login", async () => {
      requireCondition(
        (await this.run("npm", ["config", "get", "registry"])).stdout.trim() === registry &&
          (!this.pkg.publishConfig?.registry || this.pkg.publishConfig.registry === registry),
        "Expected the public npm registry",
      );
      this.username = (await this.run("npm", ["whoami", "--registry", registry])).stdout.trim();
      requireCondition(this.username, "No local npm identity");
      if (this.metadata) {
        const permissions = json(
          (
            await this.run("npm", [
              "access",
              "list",
              "collaborators",
              this.pkg.name,
              "--json",
              "--registry",
              registry,
            ])
          ).stdout,
        );
        requireCondition(
          typeof permissions[this.username] === "string" &&
            permissions[this.username].includes("write"),
          "npm account lacks package write access",
        );
      }
    });
    if (!this.state) await this.analyzeChanges();
  }

  async analyzeChanges() {
    const range = this.latestTag ? `${this.latestTag}..HEAD` : "HEAD";
    const lines = (await this.git(["log", "--format=%H %s", range])).split("\n").filter(Boolean);
    this.changes = [];
    const relevant = (file) =>
      /^(src\/|icons\/|scripts\/|example\/|\.github\/workflows\/|package(?:-lock)?\.json$|icons\.config\.json$|(?:tsconfig|biome)\.json$|\.npmrc$|LICENSE$)/.test(
        file,
      );
    const net = this.latestTag
      ? (await this.git(["diff", "--name-only", this.latestTag, "HEAD"]))
          .split("\n")
          .filter(relevant)
      : ["initial"];
    const stripVersion = (data) => {
      const object = json(data);
      delete object.version;
      if (object.packages?.[""]) delete object.packages[""].version;
      return object;
    };
    let meaningfulNet = net.some((file) => !manifests.includes(file));
    for (const file of net.filter((file) => manifests.includes(file))) {
      const before = await this.run("git", ["show", `${this.latestTag}:${file}`], {
        allowFailure: true,
      });
      const after = await this.run("git", ["show", `HEAD:${file}`], { allowFailure: true });
      if (
        before.code ||
        after.code ||
        !isDeepStrictEqual(stripVersion(before.stdout), stripVersion(after.stdout))
      )
        meaningfulNet = true;
    }
    for (const line of lines) {
      const [hash, ...words] = line.split(" ");
      const files = (
        await this.git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash])
      )
        .split("\n")
        .filter(relevant);
      let meaningful = files.some((file) => !manifests.includes(file));
      for (const file of files.filter((file) => manifests.includes(file))) {
        const before = await this.run("git", ["show", `${hash}^:${file}`], { allowFailure: true });
        const after = await this.run("git", ["show", `${hash}:${file}`], { allowFailure: true });
        if (before.code || after.code) {
          meaningful = true;
          continue;
        }
        if (!isDeepStrictEqual(stripVersion(before.stdout), stripVersion(after.stdout)))
          meaningful = true;
      }
      if (meaningful && meaningfulNet) this.changes.push({ hash, subject: words.join(" ") });
    }
    this.relevant = new Set(this.changes.map(({ hash }) => hash));
  }

  validateState() {
    const s = this.state;
    requireCondition(
      [1, 2, 3].includes(s.schema) &&
        s.repo === this.repo &&
        s.name === this.pkg.name &&
        stableVersion.test(s.version) &&
        /^[a-f0-9]{40,64}$/.test(s.base) &&
        typeof s.notes === "string" &&
        (s.npmPublishAccepted === undefined ||
          s.npmPublishAccepted === null ||
          typeof s.npmPublishAccepted === "boolean") &&
        /^sha512-[A-Za-z0-9+/]+=*$/.test(s.integrity),
      "Invalid recovery state; investigate without deleting published refs.",
    );
    for (const file of manifests) {
      requireCondition(
        typeof s.manifests?.[file]?.content === "string" &&
          /^[a-f0-9]{64}$/.test(s.manifests[file].before),
        "Invalid recovery manifest",
      );
      const data = json(s.manifests[file].content);
      requireCondition(data.version === s.version, "Recovery version mismatch");
    }
  }

  async checkTree() {
    const status = await this.git(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (!this.state) {
      requireCondition(!status, "Dirty tree");
      return;
    }
    const head = await this.git(["rev-parse", "HEAD"]);
    if (head !== this.state.base) await this.verifyCommit(head);
    const changed = (await this.git(["diff", "HEAD", "--name-only"])).split("\n").filter(Boolean);
    const staged = (await this.git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean);
    const untracked = await this.git(["ls-files", "--others", "--exclude-standard"]);
    requireCondition(
      !untracked && [...changed, ...staged].every((f) => manifests.includes(f)),
      "Unrelated recovery changes",
    );
    for (const file of manifests) {
      const actual = sha(await readFile(join(this.root, file)));
      const expected = this.state.manifests[file];
      requireCondition(
        actual === expected.before || actual === sha(expected.content),
        "Recovery files were modified externally",
      );
    }
    if (head !== this.state.base)
      requireCondition(!status, "Release commit must have a clean tree");
  }

  async refresh() {
    requireCondition(
      (await this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])) ===
        "origin/main",
      "Expected origin/main upstream",
    );
    if (this.dryRun) {
      // Read remote refs without fetching tags or changing the original repository.
      const remote = new Map(
        (await this.git(["ls-remote", "--heads", "--tags", "origin"]))
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split(/\s+/).reverse()),
      );
      const local = new Map(
        (await this.git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/tags/"]))
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split(" ")),
      );
      const tags = [...remote].filter(
        ([ref]) => ref.startsWith("refs/tags/") && !ref.endsWith("^{}"),
      );
      requireCondition(
        remote.get("refs/heads/main") === (await this.git(["rev-parse", "HEAD"])) &&
          tags.length === local.size &&
          tags.every(([ref, object]) => local.get(ref) === object),
        "Remote main/tags differ; fetch manually before a fully verified dry-run",
      );
      return;
    }
    await this.git(["fetch", "origin", "--tags", "+refs/heads/*:refs/remotes/origin/*"]);
    const head = await this.git(["rev-parse", "HEAD"]);
    const remote = await this.git(["rev-parse", "refs/remotes/origin/main"]);
    requireCondition(
      this.state ? [this.state.base, head].includes(remote) : remote === head,
      "main differs from origin/main",
    );
  }

  async acquire() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const lock = join(this.stateDir, "lock");
    try {
      this.lock = await open(lock, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(lock, "utf8"));
      requireCondition(
        Number.isSafeInteger(pid) && pid > 0,
        "Invalid release lock; investigate manually",
      );
      try {
        process.kill(pid, 0);
        throw new Error("Another release is running.");
      } catch (check) {
        if (check.code !== "ESRCH") throw check;
      }
      await rm(lock);
      this.lock = await open(lock, "wx", 0o600);
    }
    await this.lock.writeFile(String(process.pid));
  }

  async unlock() {
    if (!this.lock) return;
    await this.lock.close();
    await rm(join(this.stateDir, "lock"));
  }

  async prepare(version) {
    const stage = await mkdtemp(join(tmpdir(), "tabletennis-release-"));
    try {
      const files = (
        await this.git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean);
      const originals = {};
      for (const file of files) {
        requireCondition(
          !isAbsolute(file) && !file.split(/[\\/]/).includes(".."),
          "Unsafe snapshot path",
        );
        await mkdir(dirname(join(stage, file)), { recursive: true });
        await cp(join(this.root, file), join(stage, file), { dereference: false });
      }
      for (const file of manifests) originals[file] = await readFile(join(stage, file), "utf8");
      await symlink(join(this.root, "node_modules"), join(stage, "node_modules"), "dir");
      await this.run(
        "npm",
        ["version", version, "--no-git-tag-version", "--allow-same-version", "--ignore-scripts"],
        { cwd: stage },
      );
      const proposed = {};
      for (const file of manifests) {
        const content = await readFile(join(stage, file), "utf8");
        const expected = json(originals[file]);
        expected.version = version;
        if (file === "package-lock.json") expected.packages[""].version = version;
        requireCondition(
          isDeepStrictEqual(json(content), expected),
          "npm version changed fields other than version",
        );
        proposed[file] = { before: sha(originals[file]), content };
      }
      await this.run("npm", ["run", "build"], { cwd: stage, interactive: true });
      const packed = packResult(
        (await this.run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: stage }))
          .stdout,
      );
      requireCondition(
        packed.name === this.pkg.name &&
          packed.version === version &&
          packed.files.every(({ path }) =>
            /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(path),
          ),
        "Unexpected tarball metadata or files",
      );
      const tarball = await readFile(join(stage, "artifacts", `${this.pkg.name}-${version}.tgz`));
      requireCondition(
        packed.integrity === integrity(tarball),
        "Built tarball and pack preview differ",
      );
      this.prepared = true;
      return { manifests: proposed, tarball, integrity: integrity(tarball) };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }

  async save() {
    await atomicWrite(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  async verifyCommit(head) {
    const s = this.state;
    requireCondition(!s.commit || s.commit === head, "Recovery HEAD changed");
    requireCondition(
      (await this.git(["rev-parse", `${head}^`])) === s.base &&
        (await this.git(["log", "-1", "--format=%s", head])) === `chore: release v${s.version}`,
      "Unexpected release commit",
    );
    const changed = (await this.git(["diff", "--name-only", s.base, head]))
      .split("\n")
      .filter(Boolean);
    requireCondition(
      changed.every((file) => manifests.includes(file)),
      "Release commit includes unrelated files",
    );
    for (const file of manifests) {
      const content = (await this.run("git", ["show", `${head}:${file}`])).stdout;
      requireCondition(
        sha(content) === sha(s.manifests[file].content),
        "Release commit manifest mismatch",
      );
    }
  }

  async tagSha() {
    const tag = `v${this.state.version}`;
    const result = await this.run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
      allowFailure: true,
    });
    if (result.code === 1) return null;
    requireCondition(result.code === 0, "Cannot inspect release tag");
    const object = result.stdout.trim();
    requireCondition(
      (await this.git(["cat-file", "-t", object])) === "tag" &&
        (await this.git(["rev-parse", `${tag}^{}`])) === this.state.commit,
      "Conflicting/non-annotated release tag",
    );
    return object;
  }

  async verifyRemoteTag() {
    const tag = `v${this.state.version}`;
    const refs = await this.git([
      "ls-remote",
      "origin",
      "refs/heads/main",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    const entries = new Map(
      refs
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/\s+/).reverse()),
    );
    requireCondition(
      entries.get("refs/heads/main") === this.state.commit &&
        entries.get(`refs/tags/${tag}`) === (await this.tagSha()) &&
        entries.get(`refs/tags/${tag}^{}`) === this.state.commit,
      "Remote release refs do not match",
    );
  }

  verifyPublication(published) {
    const s = this.state;
    requireCondition(
      published?.name === s.name &&
        published?.version === s.version &&
        published?.dist?.integrity === s.integrity,
      "npm publication identity/integrity conflict; do not republish or change release refs",
    );
  }

  async publishLocal() {
    const s = this.state;
    const tarball = join(this.stateDir, "package.tgz");
    requireCondition(
      integrity(await readFile(tarball)) === s.integrity,
      "Local recovery tarball changed; do not publish",
    );
    let published = await this.npmMetadata(s.version);
    if (published) this.verifyPublication(published);
    if (!published && s.npmPublishAccepted === false) {
      requireCondition(
        this.tty && !this.ci,
        "Local npm publishing requires a terminal for npm 2FA/passkey approval",
      );
      // Unknown is saved before upload, so a killed process never blindly retries it.
      s.npmPublishAccepted = null;
      await this.save();
      this.log("Publishing the checked local tarball. npm may request 2FA/passkey approval.");
      try {
        await this.run(
          "npm",
          [
            "publish",
            tarball,
            "--access",
            "public",
            "--tag",
            "latest",
            "--registry",
            registry,
            "--ignore-scripts",
            "--provenance=false",
          ],
          { interactive: true },
        );
      } catch {
        throw new Error(
          "Local npm publish failed or was interrupted; upload outcome is uncertain. Check npm and rerun release to verify availability, never republish blindly.",
        );
      }
      s.npmPublishAccepted = true;
      await this.save();
    }
    for (let attempt = 0; !published; attempt++) {
      published = await this.npmMetadata(s.version);
      if (published) break;
      requireCondition(
        attempt < 30,
        "npm publication remains unavailable after 15 minutes; it may still be processing. Keep local recovery files and rerun release to verify, not resubmit.",
      );
      await this.pause(30_000);
    }
    this.verifyPublication(published);
    const path = `repos/${this.repo}/releases`;
    let released = await this.github(`${path}/tags/v${s.version}`, { missing: true });
    if (!released) {
      await this.github(path, {
        body: {
          tag_name: `v${s.version}`,
          name: `v${s.version}`,
          target_commitish: s.commit,
          body: s.notes,
          draft: false,
          prerelease: false,
        },
      });
      released = await this.github(`${path}/tags/v${s.version}`);
    }
    requireCondition(
      released.tag_name === `v${s.version}` && !released.draft && !released.prerelease,
      "GitHub release conflicts with local release state",
    );
    this.verifyPublication(await this.npmMetadata(s.version));
  }

  async finish() {
    await this.checkTree();
    const s = this.state;
    requireCondition(s.schema === 3, "Only checked local release recovery can be resumed");
    requireCondition(
      integrity(await readFile(join(this.stateDir, "package.tgz"))) === s.integrity,
      "Local recovery tarball changed; do not publish",
    );
    let head = await this.git(["rev-parse", "HEAD"]);
    if (head === s.base) {
      requireCondition(
        !(await this.npmMetadata(s.version)),
        "Target version already exists; investigate before creating release refs",
      );
      for (const file of manifests)
        await atomicWrite(join(this.root, file), s.manifests[file].content);
      await this.git(["add", "--", ...manifests]);
      await this.git(["commit", "--allow-empty", "-m", `chore: release v${s.version}`]);
      head = await this.git(["rev-parse", "HEAD"]);
    }
    await this.verifyCommit(head);
    s.commit = head;
    await this.save();
    if (!(await this.tagSha()))
      await this.git([
        "tag",
        "--annotate",
        `v${s.version}`,
        "--message",
        `Release v${s.version}`,
        s.commit,
      ]);
    await this.refresh();
    await this.git([
      "push",
      "--atomic",
      "origin",
      "HEAD:refs/heads/main",
      `refs/tags/v${s.version}:refs/tags/v${s.version}`,
    ]);
    await this.verifyRemoteTag();
    await this.publishLocal();
    await this.verifyRemoteTag();
    await rm(this.statePath);
    await rm(join(this.stateDir, "package.tgz"), { force: true });
    this.log(`Verified npm and GitHub release v${s.version}.`);
  }

  async perform(version, notes) {
    requireCondition(stableVersion.test(version), "Invalid release version");
    this.log(`${this.pkg.name} → ${version}\n${notes}`);
    if (this.dryRun) {
      await this.prepare(version);
      this.log("DRY RUN: no commit, tag, push, npm publish or GitHub release was performed.");
      return;
    }
    if (!this.state) {
      requireCondition(!(await this.npmMetadata(version)), "Version already exists on npm");
      requireCondition(
        !(await this.github(`repos/${this.repo}/releases/tags/v${version}`, { missing: true })),
        "GitHub release already exists",
      );
      const tag = await this.run(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/tags/v${version}`],
        { allowFailure: true },
      );
      requireCondition(tag.code === 1, "Release tag already exists or cannot be checked");
      const base = await this.git(["rev-parse", "HEAD"]);
      const candidate = await this.prepare(version);
      await this.checkTree();
      requireCondition(
        (await this.git(["rev-parse", "HEAD"])) === base,
        "HEAD changed while validating",
      );
      this.state = {
        schema: 3,
        npmPublishAccepted: false,
        repo: this.repo,
        name: this.pkg.name,
        version,
        base,
        previousTag: this.latestTag,
        notes,
        manifests: candidate.manifests,
        integrity: candidate.integrity,
      };
      await atomicWrite(join(this.stateDir, "package.tgz"), candidate.tarball);
      await this.save();
    }
    this.log(
      `Repository: ${this.repo}\nVersion: ${this.state.version}\nLocal candidate: ${this.state.integrity}\n${this.state.notes}`,
    );
    await this.finish();
  }
}

export async function runRelease(options = {}) {
  const session = new ReleaseSession(options);
  try {
    await session.initialize();
    if (!session.dryRun) await session.acquire();
    if (!session.dryRun && session.completedLegacy) {
      await rm(session.statePath);
      await rm(join(session.stateDir, "package.tgz"), { force: true });
    }
    if (!session.state && !session.initial && !session.changes.length) {
      session.log("No release-relevant changes; nothing to publish.");
      if (session.dryRun) await session.prepare(session.pkg.version);
      if (session.issues.length)
        throw new Error("Local checks passed; real-release prerequisites remain unverified.");
      return session;
    }
    configureSession(session);
    await release(
      releaseOptions({
        initial: session.initial,
        resume: Boolean(session.state),
        pendingVersion: session.pendingVersion,
        dryRun: session.dryRun,
      }),
    );
    if (session.dryRun && !session.prepared)
      await session.prepare(session.state?.version ?? session.pkg.version);
    if (session.issues.length)
      throw new Error(
        "Dry-run local checks completed, but remote/authentication prerequisites remain unverified. No release approval.",
      );
    return session;
  } finally {
    configureSession(null);
    await session.unlock();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runRelease(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    console.error(
      "Nothing is rolled back. If preparation started, rerun npm run release after resolving the problem.",
    );
    process.exitCode = 1;
  }
}
