# Agent documentation

Design confirmed. Documentation, packaging, integrated validation, and review complete.

## Settled scope

- Inventory Stack's capabilities, organize them into groups, and document them for agents using delegated documentation work.
- Ship Markdown documentation in the existing `@prinpo/stack` NPM package, reachable through a consuming application's `AGENTS.md` pointer.
- Cover the existing public Blocks, utilities, helpers, tooling, CLI workflows, and application patterns. Runtime features and new scaffolding commands are outside this work.
- Guide agents to use Stack's applicable capabilities to their fullest potential. Individual applications select the Blocks they need.
- Prescribe a preferred application structure based on the full-stack example, adapting repository-specific wiring for standalone consumers.
- Target an agent starting from an empty directory and producing a working frontend, typed API queries, database, authentication, validated environment, and local development services.
- The developer will inspect the initial documentation and manually evaluate it with different prompts and agents. Automated agent trials are not required for this initial delivery.
- Organize navigation into Blocks, utilities and helpers, application patterns, development tooling, CLI, and build and production. Give each capability one authoritative explanation and cross-link overlapping groups.
- Use a short `docs/README.md` entry point with a capability map, essential conventions, task-specific reading pointers, and a copyable consuming-application `AGENTS.md` snippet.
- Make CLI documentation operational for agents: retrieving logs, generating migrations, running doctor, and interpreting diagnostic results, rather than only listing commands.
- Ship consumer documentation only. Keep release procedures, repository issue workflows, research, milestones, and architectural history repository-only. Installed guides must contain the context needed to use Stack.
- Revise existing consumer guides into the new structure rather than maintaining competing copies.
- Explain when each capability applies, its public entry points and helpers, setup, working examples, composition patterns, and constraints. Link to upstream documentation for exhaustive native-library options.
- Do not write a new-app walkthrough or staged tutorial. Provide application structure, required configuration, patterns, and focused examples as reference material.
- For existing applications, preserve compatible structure while applying Stack's required conventions and adopting relevant Blocks and helpers. Do not require unrelated restructuring.
- Map every Stack-owned public helper, integration, CLI command, and supported workflow to its documentation. Group native reexports by library and public import path instead of duplicating upstream API references. In particular, document Stack's database utilities and integration differences, with import-path guidance and upstream Drizzle documentation for native APIs.
- Validate release-tarball inclusion of consumer docs, exclusion of maintainer docs, and local documentation links. Verify standalone setup instructions against the installed package to catch workspace-specific paths. Run the repository's required checks; prompt-based agent evaluation remains the developer's responsibility.
- Give every shipped consumer document YAML metadata: title, description, document type, topics, and related-document links, suitable for retrieval and indexing.

## Repository constraints

- Preserve the glossary's definition of independently composable Blocks and the native-API boundary in [ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md).
- Package inclusion currently requires changes to both the package manifest and release staging script.
- The source-linked full-stack example contains workspace-specific dependency and CLI wiring that standalone instructions must replace.

## Implementation

The developer confirmed the boundaries and requested implementation with subagents. Three documentation agents covered frontend/backend/query/patterns, auth/database, and CLI/environment/logging/development/production.

- Added the entry point and complete capability map; revised existing consumer guides into canonical references and added missing references.
- Added an explicit consumer-document allowlist to the package manifest and reused it in release staging. Maintainer documentation remains repository-only.
- Extended installed-tarball qualification to validate YAML metadata and local document/heading links, and to build/typecheck using configuration extracted from installed documentation.
- Kept runtime APIs unchanged. No walkthrough, scaffolding command, or automated prompt-based agent evaluation was added.

## Validation and review

- Root formatting, lint, and type checks passed; the full-stack example checks and production build passed.
- All 740 tests across 60 files passed, including the isolated installed-package qualification.
- `bun run package:check` produces and validates a local release tarball with consumer metadata, document links, and documented standalone configuration.
- Standards review found one duplicated shutdown example; replaced it with a link to the backend's canonical implementation. No hard standards violations were found.
- Spec review found one auth failure-behavior misstatement; clarified native returned status values versus the logger's internal throwing path. No missing requirements or scope creep were found.
