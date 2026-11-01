# Package releases

Stack ships TypeScript source for Bun applications. There is no compiled library distribution. CI runs root formatting, lint and type checks, example checks, the full test suite, and `bun run stack build` on pull requests, merge queues and pushes to `main`. The package integration test installs a tarball outside the workspace and verifies backend use without React, public export resolution, the defaults schema, the installed CLI and a browser build. Configure `Check` as the required branch-protection check if merge enforcement is desired.

The manual **Release** workflow (`.github/workflows/release.yml`) supports two npm channels:

| Channel   | Package version             | Git tag                      | GitHub Release                |
| --------- | --------------------------- | ---------------------------- | ----------------------------- |
| `nightly` | `0.1.0-nightly.20261101.42` | `v0.1.0-nightly.20261101.42` | Prerelease                    |
| `latest`  | `0.1.0`                     | `v0.1.0`                     | Normal release, marked latest |

Nightlies never run on a schedule. The UTC date comes from the workflow run's creation time; the final number is GitHub's workflow run number, preserved across job retries. Both channels share a concurrency group, and an active run is never cancelled by a newer request. GitHub may replace an older pending request when several runs queue; check the Actions page before assuming a queued release will execute. Manually pushed tags do not publish.

## Publish a nightly

1. On `main`, set `package.json.version` to the intended next normal version through a PR. Initially this is `0.1.0`. After a normal release, advance it before publishing another nightly; bases at or below a previously published normal version are rejected.
2. Open Actions → Release → Run workflow. Select branch **main**, channel **nightly**, and leave the normal-version and nightly-tag inputs blank.
3. Leave **prepare_only** checked to validate without publishing, or uncheck it to publish. The prepared package gets its nightly version without changing the source checkout or committing a bump.
4. Inspect the run's checks and `release-package` artifact. It contains the exact `.tgz`, `SHA256SUMS` and `release.json` (version, source commit and originating run ID).

Preparation runs all CI validation against the resolved source, then installs and validates the actual versioned release tarball. Publication uses that preserved tarball with npm OIDC and provenance. npm publication precedes Git tag and GitHub Release creation; the GitHub Release carries the tarball, checksums and metadata. Release notes compare against the previous published tag in the same channel. The first release in each channel gets an initial-release note and source link, avoiding GitHub's automatic selection of a tag from another channel.

## Promote to a normal release

After testing a published nightly, dispatch Release on **main**, select **latest**, enter its full Git tag and the matching normal version, and uncheck **prepare_only**. For example, promote `v0.1.0-nightly.20261101.42` as `0.1.0`.

The workflow uses that nightly's exact source commit, even if `main` has advanced. The nightly must have a published GitHub prerelease and its commit must belong to `main` history. The final version must match its base and exceed all previously published normal versions. The package is repacked with the normal version and validated again. Afterwards, open a PR advancing `package.json.version` to the next intended normal version.

## Initial npm bootstrap

The `@prinpo` npm scope owner performs this once, after this workflow is merged to `main`. No bootstrap scripts or publishing tokens are stored in the repository.

1. Run Release for **nightly**, with **prepare_only** checked. Download and extract its `release-package` artifact into a local directory. Note the run ID and the tarball filename in `release.json`.
2. In that directory, verify the archive and authenticate interactively:

   ```sh
   sha256sum --check SHA256SUMS
   npm login
   npm publish ./prinpo-stack-<nightly-version>.tgz --access public --tag nightly --ignore-scripts
   ```

   Replace `<nightly-version>` with the actual version. Use the downloaded archive unchanged. The local bootstrap has no GitHub provenance; subsequent CI publications do.

3. In npm, open `@prinpo/stack` → Settings → Trusted publishing → GitHub Actions. Enter GitHub owner **prinpo**, repository **stack**, workflow filename **release.yml**. Leave the environment unset: this workflow does not declare a GitHub environment. Enable **direct npm publish** and **npm dist-tag** permissions, the latter for recovery. Keep account 2FA enabled. Ongoing CI needs no `NPM_TOKEN`.
4. Dispatch Release on **main** with **prepared_run_id** set to the original prepare-only run ID and **prepare_only** unchecked. The other release-selection inputs are ignored. It revalidates the preserved tarball, verifies that npm already has those exact bytes, and finishes the Git tag and GitHub Release without republishing that version.
5. Dispatch a **new nightly** publication within two days of configuring the trusted publisher. npm requires a successful new OIDC publication to validate the connection; finishing the already published bootstrap version does not count.

The publishing job runs on a GitHub-hosted Ubuntu runner with `id-token: write`, Node 24 and npm 11.21.0. Bun installs, tests and packs; npm publishes because Bun does not currently provide the required OIDC/provenance path. Do not configure an npm token or `NODE_AUTH_TOKEN` for this job. If npm policy requires staged publishing, enable direct publication for this trusted publisher as described above.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [existing-package prerequisite](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [Bun publishing](https://bun.sh/docs/pm/cli/publish).

## Recover an interrupted release

- If preparation failed, fix the problem and dispatch a new run. Nothing has been published.
- If publication failed, prefer **Re-run failed jobs** on that run. This downloads its preserved tarball; it does not pack a replacement. Avoid **Re-run all jobs**, which would try to upload a second artifact with the same name.
- To finish a prepare-only run or recover through a new dispatch, enter its **prepared_run_id** and uncheck **prepare_only**. Only artifacts originating from this release workflow on `main` are accepted. Prepared artifacts are retained for 90 days; download them for longer-term retention. Published releases also carry them as assets.
- If npm already contains the version, its SHA-512 integrity must match the tested tarball. Matching bytes are accepted and missing metadata steps resume. Different bytes fail: choose a new version rather than unpublishing, overwriting a package, or moving a tag.
- A new publication cannot move a channel backwards. Recovery of an identical older package may finish its GitHub metadata, but does not move the npm channel backwards or mark an older normal release latest.
- If npm succeeded but registry visibility lags, rerun the failed publishing job after the version becomes visible. If GitHub asset upload failed, the release stays draft until a retry attaches all assets. Existing Git tags must already point to the intended source commit.
- If restoring a missing npm dist-tag fails, verify its permission on the trusted publisher. OIDC dist-tag management requires npm 11.21+ (the workflow pins a compatible version).

Test locally with `bun run package:check`. This prepares and validates the current source version under `dist/package`; it never publishes. Source checkout files and the lockfile remain unchanged during packaging.
