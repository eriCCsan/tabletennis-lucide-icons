import { Plugin } from "release-it";

let session;

export function compareVersions(a, b) {
  const left = a.split(".").map(BigInt);
  const right = b.split(".").map(BigInt);
  const index = left.findIndex((part, i) => part !== right[i]);
  return index < 0 ? 0 : left[index] > right[index] ? 1 : -1;
}

export function recommend(commits, relevant) {
  let level = null;
  for (const commit of commits) {
    if (relevant && !relevant.has(commit.hash)) continue;
    const next =
      commit.notes?.some((note) => /^BREAKING[ -]CHANGE/.test(note.title)) ||
      /^\w+(?:\([^)]*\))?!:/.test(commit.header)
        ? 0
        : commit.type === "feat"
          ? 1
          : 2;
    level = level === null ? next : Math.min(level, next);
  }
  return level === null ? null : { level, reason: "Release-relevant changes" };
}

export function nextVersion(baseline, level) {
  const parts = baseline.split(".").map(BigInt);
  parts[level]++;
  for (let i = level + 1; i < 3; i++) parts[i] = 0n;
  return parts.join(".");
}

export function configureSession(value) {
  session = value;
}

export function releaseOptions({
  initial = false,
  resume = false,
  pendingVersion,
  dryRun = false,
} = {}) {
  return {
    config: false,
    ci: true,
    quiet: true,
    "dry-run": dryRun,
    increment: initial || resume ? false : pendingVersion,
    git: false,
    npm: false,
    github: false,
    gitlab: false,
    plugins: {
      [import.meta.filename]: {},
      "@release-it/conventional-changelog": {
        preset: {
          name: "conventionalcommits",
          types: [
            { type: "feat", section: "Features", effect: "bump" },
            { type: "fix", section: "Bug Fixes", effect: "bump" },
          ],
        },
        tagPrefix: "v",
        tagOpts: { skipUnstable: true },
        infile: false,
        whatBump(commits) {
          const result = recommend(commits, session.relevant);
          if (
            result &&
            session.pendingVersion &&
            compareVersions(
              session.pendingVersion,
              nextVersion(session.baselineVersion, result.level),
            ) < 0
          )
            throw new Error(
              "Prepared version is lower than the Conventional Commit recommendation.",
            );
          return result;
        },
      },
    },
  };
}

// Keep release-it's public lifecycle, but never enable its destructive Git rollback.
export default class LocalRelease extends Plugin {
  init() {
    if (!session) throw new Error("Use npm run release or npm run release:dry-run.");
    this.config.setContext({
      latestTag: session.latestTag,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: release-it expands this template.
      tagTemplate: "v${version}",
      remoteUrl: `https://github.com/${session.repo}.git`,
    });
  }

  getName() {
    return session.pkg.name;
  }

  getLatestVersion() {
    return session.state?.version ?? session.baselineVersion ?? session.pkg.version;
  }

  getChangelog() {
    return session.state?.notes;
  }

  async release() {
    const { version, changelog } = this.config.getContext();
    const changes = session.changes
      ?.map(({ hash, subject }) => `- ${subject.replace(/[\r\n]/g, " ")} (${hash.slice(0, 7)})`)
      .join("\n");
    await session.perform(
      version,
      [changelog, changes && `### Changes\n\n${changes}`].filter(Boolean).join("\n\n") ||
        "Initial release.",
    );
  }
}
