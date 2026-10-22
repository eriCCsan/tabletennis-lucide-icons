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
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import release from "release-it";
import { configureSession, releaseOptions } from "./release-plugin.mjs";

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

export async function confirm(message) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(`${message} Type yes to continue [no]: `)).trim() === "yes";
  } finally {
    terminal.close();
  }
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
    ask = confirm,
    request = fetch,
    log = console.log,
    tty = process.stdin.isTTY && process.stdout.isTTY,
    ci = Boolean(process.env.CI),
  } = {}) {
    Object.assign(this, { root: resolve(root), dryRun, exec, ask, request, log, tty, ci });
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
    if (!this.dryRun)
      requireCondition(
        this.tty && !this.ci,
        "Real releases require an interactive local terminal, never CI.",
      );
    this.pkg = json(await readFile(join(this.root, "package.json"), "utf8"));
    requireCondition(
      stableVersion.test(this.pkg.version) && !this.pkg.private,
      "Expected a public package with a stable version.",
    );
    requireCondition(this.pkg.name === "tabletennis-lucide-icons", "Unexpected package name.");
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
    await this.check("Branch must be main", async () =>
      requireCondition((await this.git(["branch", "--show-current"])) === "main", "Wrong branch"),
    );
    await this.check(
      "Working directory/index must be clean (or exactly match recovery state)",
      () => this.checkTree(),
    );
    await this.check("GitHub CLI login required: install gh and run gh auth login", async () => {
      let status = await this.run("gh", ["auth", "status", "--hostname", "github.com"], {
        allowFailure: true,
      });
      if (
        status.code !== 0 &&
        !this.dryRun &&
        (await this.ask("Sign in to GitHub through your browser?"))
      ) {
        await this.run(
          "gh",
          ["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https"],
          { interactive: true },
        );
        status = await this.run("gh", ["auth", "status", "--hostname", "github.com"], {
          allowFailure: true,
        });
      }
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
    await this.check(
      "npm must use the public registry and an existing local login (npm login)",
      async () => {
        requireCondition(
          (await this.run("npm", ["config", "get", "registry"])).stdout.trim() === registry,
          "Unexpected npm registry",
        );
        requireCondition(
          !this.pkg.publishConfig?.registry || this.pkg.publishConfig.registry === registry,
          "Unexpected publish registry",
        );
        this.username = (await this.run("npm", ["whoami", "--registry", registry])).stdout.trim();
        requireCondition(this.username, "Missing npm identity");
      },
    );
    await this.check("npm publishing 2FA (auth-and-writes) must be enabled", async () => {
      const profile = json(
        (await this.run("npm", ["profile", "get", "--json", "--registry", registry])).stdout,
      );
      requireCondition(
        profile.tfa?.mode === "auth-and-writes" && !profile.tfa.pending,
        "Enable npm publishing 2FA manually",
      );
    });
    this.metadata = await this.check("npm package existence/versions", () => this.npmMetadata());
    const allTags = (await this.git(["tag", "--list", "--sort=-v:refname"]))
      .split("\n")
      .filter(Boolean);
    const tags = allTags.filter((t) => t.startsWith("v") && stableVersion.test(t.slice(1)));
    this.latestTag = this.state?.previousTag ?? tags[0];
    this.initial = this.metadata === null && allTags.length === 0 && !this.state;
    if (!this.state)
      await this.check(
        "Manifest, npm and release tags must describe the same baseline",
        async () => {
          if (this.initial) {
            requireCondition(
              this.pkg.version === "0.1.0",
              "Unexpected unpublished initial version",
            );
            return;
          }
          requireCondition(
            this.metadata?.versions?.[this.pkg.version] &&
              this.metadata["dist-tags"]?.latest === this.pkg.version &&
              this.latestTag === `v${this.pkg.version}`,
            "Published baseline is inconsistent; investigate manually",
          );
          await this.git(["merge-base", "--is-ancestor", this.latestTag, "HEAD"]);
        },
      );
    if (this.metadata && this.username)
      await this.check("npm collaborator write permission", async () => {
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
        requireCondition(permissions[this.username]?.includes("write"), "No npm write permission");
      });
  }

  validateState() {
    const s = this.state;
    requireCondition(
      s.schema === 1 &&
        s.repo === this.repo &&
        s.name === this.pkg.name &&
        stableVersion.test(s.version) &&
        /^[a-f0-9]{40,64}$/.test(s.base) &&
        typeof s.notes === "string" &&
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
      const [packed] = json(
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

  async finish() {
    await this.checkTree();
    const s = this.state;
    const tarball = join(this.stateDir, "package.tgz");
    requireCondition(
      integrity(await readFile(tarball)) === s.integrity,
      "Recovery tarball changed",
    );
    const existing = await this.npmMetadata(s.version);
    requireCondition(
      !existing || existing.dist?.integrity === s.integrity,
      "npm version/integrity conflict; do not change release refs",
    );
    let head = await this.git(["rev-parse", "HEAD"]);
    if (head === s.base) {
      this.log("Creating the checked version commit (no automatic rollback).");
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
    this.log("Synchronizing only main and the annotated release tag.");
    await this.refresh();
    await this.git([
      "push",
      "--atomic",
      "origin",
      "HEAD:refs/heads/main",
      `refs/tags/v${s.version}:refs/tags/v${s.version}`,
    ]);
    await this.verifyRemoteTag();
    let published = await this.npmMetadata(s.version);
    if (!published) {
      this.log(
        "npm will request interactive 2FA/passkey approval. No OTP is stored or supplied by this script.",
      );
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
        ],
        { interactive: true },
      );
      published = await this.npmMetadata(s.version);
    }
    requireCondition(
      published?.name === s.name &&
        published.version === s.version &&
        published.dist?.integrity === s.integrity,
      "npm publication missing or integrity conflict; do not republish blindly",
    );
    const path = `repos/${this.repo}/releases`;
    let githubRelease = await this.github(`${path}/tags/v${s.version}`, { missing: true });
    if (!githubRelease)
      githubRelease = await this.github(path, {
        body: {
          tag_name: `v${s.version}`,
          name: `v${s.version}`,
          body: s.notes,
          target_commitish: s.commit,
          draft: false,
          prerelease: false,
        },
      });
    requireCondition(
      githubRelease.tag_name === `v${s.version}` &&
        githubRelease.body === s.notes &&
        !githubRelease.draft &&
        !githubRelease.prerelease,
      "GitHub release conflicts with recovery state",
    );
    await this.verifyRemoteTag();
    const verified = await this.github(`${path}/tags/v${s.version}`);
    requireCondition(
      verified.id === githubRelease.id && verified.body === s.notes && !verified.draft,
      "GitHub release verification failed",
    );
    await rm(this.statePath);
    await rm(tarball);
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
      if (!(await this.ask(`Prepare local release ${version}?`))) return;
      const base = await this.git(["rev-parse", "HEAD"]);
      const candidate = await this.prepare(version);
      await this.checkTree();
      requireCondition(
        (await this.git(["rev-parse", "HEAD"])) === base,
        "HEAD changed while validating",
      );
      this.state = {
        schema: 1,
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
      `Repository: ${this.repo}\nVersion: ${this.state.version}\nTarball: ${this.state.integrity}\n${this.state.notes}`,
    );
    if (!(await this.ask("COMMIT, TAG, PUSH AND PUBLISH this checked release?"))) {
      this.log("Stopped without publication. Rerun npm run release to resume this version.");
      return;
    }
    await this.finish();
  }
}

export async function runRelease(options = {}) {
  const session = new ReleaseSession(options);
  try {
    await session.initialize();
    if (!session.dryRun) await session.acquire();
    configureSession(session);
    await release(
      releaseOptions({
        initial: session.initial,
        resume: Boolean(session.state),
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
