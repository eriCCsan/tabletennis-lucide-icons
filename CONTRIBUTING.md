# Contributing

Run `npm ci` once. `npm run check` validates sources without building; `npm run build`
also checks generated modules, browser examples, types, tree-shaking and the npm tarball.
Browser tests need Playwright Chromium (`npx --no-install playwright install chromium`)
or system Google Chrome. React Native device/Expo rendering requires separate device testing.

## SVG requirements

Use the next consecutive number and a unique lowercase hyphenated name, e.g.
`NN-your-icon.svg`. Its export becomes `YourIcon`. Add multiple files together if needed.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" color="#000000" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 32H48"/>
</svg>
```

Keep these root attributes. Use only direct `path` and `circle` children with
`currentColor` or `none` fills/strokes. Paths need `d`; circles need `cx`, `cy` and
positive `r`. Filled details may use `fill="currentColor" stroke="none"`; paths may
use `fill-rule="evenodd"`. Flatten groups/transforms and remove metadata, comments,
styles, IDs, external references, raster images, masks and clipping paths.

Run `npm run icons:add`: it validates numbering/SVGs, protects every existing hash
in `icons/checksums.json`, registers new hashes, then runs the complete build.
A failed build restores only that registry update, provided nobody edited it meanwhile.
Existing artwork changes require explicit review; this command never approves them.
No manual export registration is needed. Inspect both existing examples before committing.

## API and assets

`icons.config.json` is the build configuration. Defaults: size 24, color
`currentColor`, strokeWidth 0.75, absoluteStrokeWidth false. Explicit props override
them. Strokes scale from their nominal width at size 24; `absoluteStrokeWidth`
keeps the visible width constant for numeric sizes. `nonScalingStroke` uses SVG
vector effects and takes precedence. Filled details retain their geometry.
React and React Native accept their platform SVG props and refs; vanilla functions
return SVG elements. Browser `currentColor` inherits text color; prefer explicit
colors on native platforms.

Public entries: `/react`, `/react-native`, `/vanilla`, `/icons/*.svg`, `/sprite.svg`,
`/sheet.svg`, `/sheet.png`. Import SVGs/sheets as asset URLs with a supporting
bundler. Copy the sprite to public assets and use `<use href="/sprite.svg#paddle">`
inside an SVG; IDs are source slugs without numbering. External images do not
inherit page colors. Sheet rendering has separate configuration overrides.
Install the built `artifacts/*.tgz` in a consumer for local package testing.

## Releases

Install GitHub CLI and sign in locally with `gh auth login` and `npm login`.
Your accounts must have repository push/release access and npm package write access.
Branch/tag rules must permit the release commit, annotated tag and atomic push
without bypasses. Run real releases in a local terminal, never CI.
npm handles required 2FA/passkey approval; the script never stores OTPs or creates
tokens. No GitHub Actions workflow, Trusted Publisher or publishing secrets are needed.

`npm run release:dry-run` builds a temporary snapshot without modifying source
versions, Git refs or recovery state. Missing main/clean-tree/remote prerequisites
are reported separately and cause a nonzero exit after local checks.

`npm run release` requires clean `main` matching freshly fetched `origin/main`.
Conventional Commits select patch (`fix:`), minor (`feat:`) or major (`!` /
`BREAKING CHANGE`, including before 1.0). Other library/tooling changes default to
patch; documentation/tests-only changes and version-only edits do not release.
A manually committed version is respected when at least the recommended version.
Notes include relevant nonstandard commit subjects. GitHub Releases are the changelog.

After validation, the command creates the version commit and annotated `v` tag,
atomically pushes both, publishes the checked local tarball using your npm login,
waits for npm processing, then creates/verifies the GitHub release through GitHub CLI.
Existing versions/tags/releases are never overwritten. An unchanged fully released
baseline is a no-op. Local publishing does not generate CI provenance.

On failure, fix the reported cause and rerun `npm run release`. The exact checked
tarball, manifests, notes and upload receipt stay under Git's administrative
directory. If npm succeeded, only the missing GitHub release is created.
An interrupted or failed npm command leaves an uncertain upload receipt: retries
only check registry availability and never blindly resubmit the upload.
If the version remains unavailable, investigate npm processing/review or rejection
before explicitly approving another attempt; do not discard recovery evidence.
Missing/corrupted recovery files and integrity conflicts require manual investigation.
Never delete published tags, force-push, unpublish or rebuild a tagged package to retry.
No automatic rollback is performed.

The patched undici override stays within its major version. The scoped basic-ftp
override fixes its LIST parser and preserves its secure default blocking FTP
bounce/separate-host data connections. These affect development release tooling,
not runtime consumers. Review overrides when upstream dependencies catch up.
