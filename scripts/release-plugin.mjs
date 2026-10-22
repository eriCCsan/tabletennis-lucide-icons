import { Plugin } from "release-it";

let session;

export function configureSession(value) {
  session = value;
}

export function releaseOptions({ initial = false, resume = false, dryRun = false } = {}) {
  return {
    config: false,
    ci: false,
    quiet: true,
    "dry-run": dryRun,
    increment: initial || resume ? false : undefined,
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
    return session.state?.version ?? session.pkg.version;
  }

  getChangelog() {
    return session.state?.notes;
  }

  async release() {
    const { version, changelog } = this.config.getContext();
    await session.perform(version, changelog || "Initial release.");
  }
}
