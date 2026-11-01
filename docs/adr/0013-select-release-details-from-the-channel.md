# Select release details from the channel

Keep only the release channel as a workflow input. Stack currently has one developer, so manually selecting a nightly tag, repeating its normal version, and supplying recovery run IDs adds routine coordination without enough benefit. `nightly` packages the dispatched `main` commit; `latest` selects the highest published nightly version, retains its exact source commit, and derives the normal version from that commit's manifest. Drafts and non-nightly releases are excluded. This supersedes ADR 0011's explicit promotion inputs while preserving tested-source promotion and immutable versions.

Use GitHub's failed-job rerun mechanism to reuse that run's validated tarball. Remove cross-run restoration from the public form and implementation; historical repair after workflow code changes is separate maintenance.

Keep the built-in GitHub token with Contents write permission for tags and release metadata, and retain OIDC for npm publishing. The earlier 403 occurred while repairing a historical nightly whose workflow files differed from the default branch. Publish a fresh nightly after workflow changes instead of introducing a separate credential for that exceptional case; promotion checks this before npm submission.
