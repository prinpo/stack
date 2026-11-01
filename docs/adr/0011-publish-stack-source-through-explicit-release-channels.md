# Publish Stack source through explicit release channels

Publish `@prinpo/stack` as TypeScript source, including its Bun CLI and required runtime assets. Consuming applications require Bun, so compiling a separate JavaScript distribution adds work without serving a supported runtime. Keep repository examples linked to source, but validate an installed package tarball in CI before publication; this reopens ADR 0004's deferred distribution verification while preserving its development workflow.

Use `main` as the integration branch and immutable `v…` Git tags to identify release commits, without permanent channel branches. Publish normal `x.y.z` versions to npm's `latest` dist-tag and `x.y.z-nightly.YYYYMMDD.RUN_NUMBER` versions to `nightly`; initial normal versions remain in the `0.y.z` range. These are the only release channels. Maintainers explicitly choose normal release versions rather than deriving them from commit messages. Date-bearing nightly versions make their age visible and distinguish them from normal releases.

Both channels require a manual release request; no scheduled nightly publication runs. A normal release selects an explicit nightly Git tag and final version, packages that nightly's exact source commit with the final version, and validates the resulting package again before publication. This allows `main` to advance without introducing untested changes into the selected release. Keep the intended next normal version in `package.json` on `main`, adding nightly suffixes only during packaging; this convention can be revisited after experience with the workflow.

Start with an intended normal version of `0.1.0` and publish nightlies before explicitly promoting a tested one to `0.1.0`. A promoted normal version must match the selected nightly's base version and be newer than every previously published normal version, preventing accidental regression of npm's `latest` channel.

Create GitHub Releases for both channels: normal releases are marked latest, and nightlies are marked prerelease. Generate notes against the previous release in the same channel. Use GitHub OIDC trusted publishing and npm provenance for ongoing publication. The npm scope owner performs the initial authenticated package publication using instructions, without adding one-use bootstrap scripts to the repository.

Use Bun to install, validate, and pack Stack, then publish the validated tarball with the npm CLI under Node. At the time of this decision, Bun's publisher does not support the required OIDC/provenance path; publication tooling does not change Stack's Bun runtime requirement.

Manual GitHub Actions dispatch is the only publication trigger. Nightly requests select `main`; normal requests select an existing nightly tag. The workflow creates release tags itself, and pushing a tag manually does not publish. After a normal release, a maintainer must advance the intended version through a PR before another nightly can publish; reject a nightly whose base version has already shipped.

Publish the validated tarball to npm before creating its Git tag and GitHub Release. Preserve the tarball and checksums so an interrupted release can verify an already published npm artifact and finish missing GitHub steps. Never replace a published version or move an existing release tag; changed package contents require a new version.

The initial bootstrap used a reusable prepare-only option. [ADR 0012](0012-complete-releases-after-npm-accepts-the-tested-tarball.md) removes that option after bootstrap and replaces immediate registry-visibility checks with successful npm submission as the completion gate. Every release request now proceeds from tarball validation to npm publication.
