# Package releases

Stack ships TypeScript source for Bun applications. There is no compiled library distribution. CI runs root formatting, lint and type checks, example checks, the full test suite, and `bun run stack build` on pull requests, merge queues and pushes to `main`. The package integration test installs a tarball outside the workspace and verifies backend use without React, public export resolution, the defaults schema, the installed CLI and a browser build. Configure `Check` as the required branch-protection check if merge enforcement is desired.

CI and release preparation use the PC's self-hosted runner, labelled `prinpo-stack`. The npm publishing job stays on a GitHub-hosted runner because npm trusted publishing does not support self-hosted runners. See [runner operation](self-hosted-runner.md) for setup, maintenance and troubleshooting.

The manual **Release** workflow (`.github/workflows/release.yml`) has one input: **channel**. Run it from branch **main** and choose one of two npm channels:

| Channel   | Package version             | Git tag                      | GitHub Release                |
| --------- | --------------------------- | ---------------------------- | ----------------------------- |
| `nightly` | `0.1.0-nightly.20261101.42` | `v0.1.0-nightly.20261101.42` | Prerelease                    |
| `latest`  | `0.1.0`                     | `v0.1.0`                     | Normal release, marked latest |

Nightlies never run on a schedule. Every release request validates a tarball and proceeds to npm publication; there is no prepare-only mode. The UTC date comes from the workflow run's creation time; the final number is GitHub's workflow run number, preserved across job retries. Both channels share a concurrency group, and an active run is never cancelled by a newer request. GitHub may replace an older pending request when several runs queue; check the Actions page before assuming a queued release will execute. Manually pushed tags do not publish.

## Publish a nightly

1. On `main`, set `package.json.version` to the intended next normal version through a PR. Initially this is `0.1.0`. After a normal release, advance it before publishing another nightly; bases at or below a previously published normal version are rejected.
2. Open Actions → Release → Run workflow. Select branch **main** and channel **nightly**.
3. Run the workflow. The prepared package gets its nightly version without changing the source checkout or committing a bump; successful validation always proceeds to publishing.
4. Inspect the run's checks and `release-package` artifact. It contains the exact `.tgz`, `SHA256SUMS` and `release.json` (version, source commit and originating run ID).

Preparation runs all CI validation against the resolved source, then installs and validates the actual versioned release tarball. The consumer installs Stack from the local `.tgz`, not from the npm registry. Publication submits that preserved tarball with npm OIDC and provenance. A successful npm command is sufficient to create the Git tag and GitHub Release; the workflow does not wait for npm's public metadata or try to install the just-submitted version from npm. The GitHub Release carries the tested tarball, checksums and metadata. npm may make the version installable later, after processing.

Release notes compare against the previous published tag in the same channel. The first release in each channel gets an initial-release note and source link, avoiding GitHub's automatic selection of a tag from another channel.

## Promote to a normal release

After testing the newest successful nightly, dispatch Release on **main** and select **latest**. The workflow automatically chooses the highest published nightly version and derives its normal version from that commit's `package.json`. For example, `v0.1.0-nightly.20261101.42` becomes `0.1.0`. Drafts, unpublished releases and non-nightly tags are excluded. If no successful nightly exists, the workflow explains that a nightly must be published first. If npm is still processing the nightly, its tested tarball is available as a GitHub Release asset.

The workflow uses that nightly's exact source commit, even if `main` has advanced. The nightly must have a published GitHub prerelease and its commit must belong to `main` history. The final version must match its base and exceed all previously published normal versions. Both visible npm versions and completed GitHub Releases count for this policy, including successful submissions whose npm visibility is pending. The package is repacked with the normal version and validated again. Afterwards, open a PR advancing `package.json.version` to the next intended normal version.

`package.json` is the only place to choose the intended normal version. There is no manual tag, version override or cross-run recovery field in the release form. Selecting an older nightly or repairing a historical release is an exceptional maintenance operation rather than a routine workflow option.

## npm publishing configuration

The initial package bootstrap and OIDC validation are complete. In npm's `@prinpo/stack` settings, the trusted publisher is GitHub owner **prinpo**, repository **stack**, workflow filename **release.yml**, with no environment. Enable **direct npm publish** and **npm dist-tag** permissions, the latter for recovery. Keep account 2FA enabled. Ongoing CI needs no `NPM_TOKEN` or local bootstrap publication.

The publishing job runs on a GitHub-hosted Ubuntu runner with `id-token: write`, Node 24 and npm 11.21.0. Bun installs, tests and packs; npm publishes because Bun does not currently provide the required OIDC/provenance path. npm commands explicitly use the artifact directory as their project prefix, avoiding the checkout's Bun-only `devEngines`. Do not configure an npm token or `NODE_AUTH_TOKEN` for this job.

This workflow uses `npm publish`. npm's optional `npm stage publish` flow requires separate maintainer approval and is not enabled here. Successful submission still does not guarantee immediate public availability. See [npm staged publishing](https://docs.npmjs.com/staged-publishing/) for that separate flow.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [existing-package prerequisite](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [Bun publishing](https://bun.sh/docs/pm/cli/publish).

## GitHub tag permissions

The GitHub-hosted publisher uses the built-in `GITHUB_TOKEN` with `contents: write` for tags and GitHub Releases. No personal access token or additional GitHub secret is needed for the normal release flow. npm authentication remains OIDC, and the self-hosted preparation job keeps its read-only token.

GitHub may require extra permission when tagging a historical commit whose workflow files differ from the default branch. For this project's normal flow, publish a fresh nightly after workflow changes rather than adding a separate credential for historical tagging. Promotion checks this before publishing and asks for a fresh nightly when needed. See GitHub's [release permissions](https://docs.github.com/en/rest/releases/releases#create-a-release).

## Recover an interrupted release

- If preparation failed, fix the problem and dispatch a new run. Nothing has been published.
- If publication failed, prefer **Re-run failed jobs** on that run. This downloads its preserved tarball; it does not pack a replacement. Avoid **Re-run all jobs**, which would try to upload a second artifact with the same name.
- There is no cross-run restore input. Use the original run's **Re-run failed jobs** for ordinary retries. If recovery requires changing workflow code, handle the historical release separately instead of dispatching a replacement with a run ID. Artifacts are retained for 90 days; download them for longer-term retention. Published releases also carry them as assets.
- If npm already contains the version, its SHA-512 integrity must match the tested tarball. Matching bytes are accepted and missing metadata steps resume. Different bytes fail: choose a new version rather than unpublishing, overwriting a package, or moving a tag.
- A new publication cannot move a channel backwards. Recovery of an identical older package may finish its GitHub metadata, but does not move the npm channel backwards or mark an older normal release latest.
- Registry visibility lag after successful npm submission does not fail the workflow. If npm succeeded but a later GitHub operation failed, let npm finish processing before retrying so its visible integrity can prove the previous submission. If GitHub asset upload failed, the release stays draft until a retry attaches all assets. Existing Git tags must already point to the intended source commit.
- If restoring a missing npm dist-tag fails, verify its permission on the trusted publisher. OIDC dist-tag management requires npm 11.21+ (the workflow pins a compatible version).

Test locally with `bun run package:check`. This prepares and validates the current source version under `dist/package`; it never publishes. Source checkout files and the lockfile remain unchanged during packaging.
