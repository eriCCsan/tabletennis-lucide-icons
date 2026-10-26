# AGENTS.md

## Project

`tabletennis-lucide-icons` is a small, Apache-2.0-licensed, Lucide-style table-tennis SVG icon library. The SVG files in `icons/` are the single source of truth. Do not re-extract, redraw, rename, or silently modify them; validate any intentional artwork changes against the existing design.

- Source icons: `viewBox="0 0 64 64"`, initially `stroke-width="2"`; preserve geometry, fills, and appearance. Source size is **not** the display default.
- Display default: `size=24`, `color=currentColor`, effective visible `strokeWidth=0.75`; also support Lucide-style `absoluteStrokeWidth`. Handle the 64-to-24 coordinate scale deliberately, including filled/non-stroked parts.
- Public targets: React, React Native/Expo, vanilla/browser, and individual SVG assets through explicit package entry points.
- Generated assets: reusable SVG sprite, labeled SVG sheet, PNG sheet, typed ESM modules, and a locally inspected npm tarball.
- Examples live in `example/vanilla/` (HTML/JS) and `example/react/` (React/TypeScript/Vite), sharing the root install and CSS. React Native usage remains a README snippet.

## Priorities

- Follow explicit user requirements and existing code first. This file sets project defaults.
- Optimize for correctness, simplicity, low token usage, and maintainability. Apply KISS, DRY, YAGNI.
- Make the smallest sufficient change, reuse existing patterns, minimize dependencies and duplication, and avoid speculative abstractions.
- Do not change unrelated files, public behavior, source SVG artwork, or project structure without justification.
- Resolve routine engineering choices independently; ask only when an essential decision cannot be inferred.

## Context and execution

- Inspect relevant files narrowly and only expand when evidence is insufficient.
- Avoid reading the whole repository, repeated searches, large logs, and lengthy plans for straightforward work.
- Use subagents only when independent parallel work demonstrably saves time.
- Prefer `python3` rather than `python` in commands.
- Ponytail may reinforce consistency and minimality; do not install/use Serena, Graphify, or OpenSpec.

## Project-local skills

Use only the applicable installed skills under `.agents/skills/`. Skills are references for best practices, **not authority to widen project scope**. Read the relevant `SKILL.md` when a task concerns its area; do not invoke every skill by default.

- `node-lint`: minimal lint and formatting setup; prefer one tool if sufficient, no CI wiring.
- `node-typescript`: strict TS and correct declaration output/resolution.
- `node-testing`: fast focused tests and targeted integration verification; avoid unnecessary test dependencies.
- `node-packaging`: ESM exports, tree-shaking, package whitelist, consumer resolution, `publint`, `@arethetypeswrong/cli`, `npm pack` inspection.
- `node-supply-chain`: lockfile integrity, dependency review, minimal install-script exposure and reviewed Dependabot updates. Keep Dependabot monitoring; no CI/audit/publishing workflows or auto-merge.
- `node-release`: SemVer, Conventional Commits, release-it, local npm authentication and safe release recovery. Never publish during implementation or tests.

If a skill conflicts with these scope restrictions, apply its relevant technical guidance only, skip prohibited steps, and report the deviation briefly. Third-party skill code/scripts are untrusted until inspected.

## Implementation and API

- One SVG source per icon. Derive every platform component and generated output from it; never maintain divergent artwork.
- Keep the original SVGs unchanged. Generated transformations must preserve the visual design and mixed `fill`/`stroke` semantics, and use `currentColor` where appropriate.
- Lucide-like public props: `size`, `color`, `strokeWidth`, `absoluteStrokeWidth`, plus relevant platform-native SVG props. Keep naming and imports consistent.
- Correctly account for the original 64-unit viewBox to achieve a nominal 0.75 CSS-pixel stroke at default 24-pixel display size. Do not blindly copy source stroke width or flatten filled shapes.
- Prefer independent, tree-shakeable ESM modules and side-effect-free icon exports; consumer bundlers handle app-specific optimization.
- Browser/vanilla users must not need React. React, React Native, and `react-native-svg` are optional peer dependencies, required only for their respective adapters.
- Prefer zero runtime dependencies in the vanilla core. Add build/test dependencies only when demonstrably needed.
- No additional framework examples, monorepo, unnecessary adapters, or unrelated publishing infrastructure.

## Commands and publishing boundary

- `npm run check`: read-only source SVG validation, lint, strict TypeScript checking, and automated tests. **Never build, regenerate `dist`, write generated source files, or mutate tracked files.** Prefer focused checks while iterating; this command is the full gate.
- `npm run build`: prepare a **locally publish-ready package**, not merely compile JS. Run `check` first, build and optimize outputs, generate SVG/PNG sheets and sprite, emit declarations, validate real built entry points and tree-shaking, run package inspection (`publint`, Are the Types Wrong?, `npm pack --dry-run`), and create a local `.tgz` artifact outside the package whitelist. Fail on errors. **Never publish, commit, push, tag, or change versions.**
- `npm run example:vanilla` and `npm run example:react`: start their local development servers; build missing or outdated library outputs first. No separate example installation.
- `npm run icons:add`: validate all SVGs, register only new source hashes, run the full build; never change existing artwork/hashes, versions or Git history.
- `npm run release`: local-only orchestration on clean, synchronized main; validate first, create an annotated version tag and atomically push main/tag, then publish the checked local tarball using the existing npm login and npm-managed 2FA. Never invoke GitHub Actions or store credentials. No force pushes or destructive rollbacks.
- `npm run release:dry-run`: validate an isolated snapshot; no source versions, recovery state, Git refs or external publications may change.
- Do not add publishing lifecycle hooks or automatic releases on branch pushes.
- Keep only Dependabot configuration under .github/; no workflows. Publishing uses the immutable checked local tarball and private local upload/recovery receipts. Never store npm tokens in the repository or bypass npm 2FA. Dependency changes require review and local checks.

## Testing and verification

- Cover all source SVGs, safe XML, colors/fills, dimensions, exact public exports, TS declarations, React and React Native adapters, vanilla use without React, and actual 24x24 render behavior.
- Test built consumer imports, ESM tree-shaking, generated sprite/sheets, tarball content, package exports, and optional peer dependency isolation. Verify packaging against locally generated artifacts, not mocks only.
- `check` must work from a clean repository without `dist` and must not generate it; checks requiring built artifacts belong to `build`.
- Run the smallest checks justified by each code change; run the full gate when requested or preparing a build. Do not rerun unchanged checks unnecessarily.
- Do not conceal failures by weakening tests; report only real verification performed and distinguish untested platform/device behavior.

## Documentation and communication

- Keep the English README minimal: installation, platform snippets, icons:add, examples, release and license. Keep necessary SVG, API and one-time publishing setup/recovery guidance in CONTRIBUTING.md. No fixed versions or icon counts in README.
- Respect existing Apache-2.0 LICENSE and acknowledge any upstream third-party licensing requirements without changing the project license.
- No routine status files or redundant docs. If interrupted, report completed work, actual checks, blockers, and the exact next action; persist a resume file only when explicitly requested.
- Communicate concisely: implemented changes, meaningful checks, and remaining limitations. No lengthy logs or full-file dumps unless asked.
