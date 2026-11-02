# Package releases

Stack ships TypeScript source for Bun applications. There is no compiled library distribution. CI runs root formatting, lint and type checks, example checks, the full test suite, and `bun run stack build` on pull requests, merge queues and pushes to `main`. The package integration test installs a tarball outside the workspace and verifies backend use without React, public export resolution, the defaults schema, the installed CLI and a browser build. Configure `Check` as the required branch-protection check if merge enforcement is desired.

CI and release preparation use the PC's self-hosted runner, labelled `prinpo-stack`. The npm publishing job stays on a GitHub-hosted runner because npm trusted publishing does not support self-hosted runners. See [runner operation](self-hosted-runner.md) for setup, maintenance and troubleshooting.

The manual **Release** workflow (`.github/workflows/release.yml`) has two inputs: **channel** and an optional **version** override for normal releases. Run it from branch **main** and choose one of two npm channels:

| Channel   | Package version             | Git tag                      | GitHub Release                |
| --------- | --------------------------- | ---------------------------- | ----------------------------- |
| `nightly` | `0.1.1-nightly.20261101.42` | `v0.1.1-nightly.20261101.42` | Prerelease                    |
| `latest`  | `0.1.1`                     | `v0.1.1`                     | Normal release, marked latest |

The root `package.json.version` records the **last stable release**, not the next development version. With recorded stable version `0.1.0`, nightlies automatically target `0.1.1`. Do not manually bump the manifest after releasing: normal-release finalization records the shipped version for you. The private example has no version field and needs no version bookkeeping.

Nightlies never run on a schedule. Every release request validates a tarball and proceeds to npm publication; there is no prepare-only mode. The UTC date comes from the workflow run's creation time; the final number is GitHub's workflow run number, preserved across job retries. Both channels share a concurrency group, and an active run is never cancelled by a newer request. GitHub may replace an older pending request when several runs queue; check the Actions page before assuming a queued release will execute. Manually pushed tags do not publish.

## Publish a nightly

1. Open Actions → Release → Run workflow. Select branch **main** and channel **nightly**. Leave **version** empty; supplying it for a nightly is rejected.
2. Run the workflow. It adds one patch to the recorded stable version, then adds the nightly suffix without changing the source checkout or committing a bump. Every nightly in the same development cycle uses that same next-patch base.
3. Inspect the run's checks and `release-package` artifact. It contains the exact `.tgz`, `SHA256SUMS` and `release.json` (version, source commit and originating run ID).

Preparation runs all CI validation against the resolved source, then installs and validates the actual versioned release tarball. The consumer installs Stack from the local `.tgz`, not from the npm registry. Publication submits that preserved tarball with npm OIDC and provenance. A successful npm command is sufficient to create the Git tag and GitHub Release; the workflow does not wait for npm's public metadata or try to install the just-submitted version from npm. The GitHub Release carries the tested tarball, checksums and metadata. npm may make the version installable later, after processing.

Release notes compare against the previous published tag in the same channel. The first release in each channel gets an initial-release note and source link, avoiding GitHub's automatic selection of a tag from another channel.

## Promote to a normal release

After testing the newest successful nightly, dispatch Release on **main** and select **latest**. The workflow automatically chooses the highest published nightly version. With **version** empty, it uses the version that nightly previewed: `v0.1.1-nightly.20261101.42` becomes `0.1.1`. Drafts, unpublished releases and non-nightly tags are excluded. If no successful nightly exists, the workflow explains that a nightly must be published first. If npm is still processing the nightly, its tested tarball is available as a GitHub Release asset.

For a minor or major release, set **version** to a newer plain version such as `0.2.0`. The workflow still uses the selected nightly's exact source commit; only the final package version changes. A nightly named `0.1.1-nightly.…` can therefore become `0.2.0` through this override.

The source commit must belong to `main` history. The final version must exceed the recorded stable version and all previously published normal versions. Both visible npm versions and completed GitHub Releases count for this policy, including successful submissions whose npm visibility is pending. The package is repacked with the final version and validated again. There is no manual tag or cross-run recovery field in the release form.

## Automatic stable bookkeeping

After npm submission and GitHub Release publication succeed for **latest**, the **Record stable version** job checks out the current `main`, writes the released version into the root manifest, refreshes `bun.lock` without upgrading dependencies, and runs repository checks. It commits only the manifest and lockfile as `chore(release): record vX.Y.Z`, then pushes with the built-in `GITHUB_TOKEN`. It runs on a GitHub-hosted runner so the PC's preparation runner retains read-only repository access.

The finalizer re-fetches and reapplies the version change if a developer pushes to `main` concurrently. It never force-pushes, makes no duplicate commit on retry, and does not downgrade a newer stable version already recorded on `main`. A failed validation or push leaves the published package and release intact; rerun only the failed finalization job. New nightlies targeting an already shipped patch are blocked until bookkeeping is completed.

After releasing `0.1.1`, the manifest records `0.1.1` and the next nightly automatically targets `0.1.2`. After an override to `0.2.0`, it automatically targets `0.2.1`. No development-version bump is needed.

The bookkeeping push does not trigger push CI because it uses `GITHUB_TOKEN`; the finalizer runs checks before committing. The current unprotected `main` permits this without a PAT, release app or new secret. If branch rules change, revisit the automation's push policy. See [GitHub's token-trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

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
- If **Record stable version** fails after a normal release succeeds, rerun that failed job. It records the already released version without publishing again. Do not manually bump to the next patch as a workaround.

Test locally with `bun run package:check`. This prepares and validates the current source version under `dist/package`; it never publishes. Source checkout files and the lockfile remain unchanged during packaging.
