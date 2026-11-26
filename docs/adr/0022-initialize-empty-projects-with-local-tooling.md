# Initialize empty projects with local tooling

[ADR 0029](0029-initialize-projects-with-a-tanstack-router-frontend.md) revises the application source scope of this decision.

Provide an interactive `bunx @prinpo/stack init` command that creates a new project with local Vite+, Stack, TypeScript, compatible React peers, application-owned tooling configuration, and an agent-documentation pointer. Install the exact Stack version running the initializer, including prerelease versions, so initialization uses that release's tested tooling rather than independently selecting the latest versions.

This narrows ADR 0002's exclusion of generators and brings interactive project initialization from ADR 0010 into scope. Initialization creates project infrastructure without application source, routes, HTML, server, database, or example tests. Developers and agents assemble the applicable Blocks afterward; initialization does not select an application template.

Generated projects adopt the root repository's type-aware linting, type checking, formatting and import ordering, generated-file exclusions, staged checks, and Git hooks, adapted to standalone applications. These configurations belong to the application and remain editable. Tooling must work without a globally installed `vp`; development and application builds become available once application entry points exist.

Linux remains the tested platform, but the CLI must not reject other operating systems based on platform identity. Commands may fail on unsupported operations; this does not constitute a promise of cross-platform support.

Stack owns the Zed and VS Code configuration files copied into new projects. Vite+ exposes neither a supported editor-only command nor a public editor generator, so initialization must not depend on its private implementation or run application migration to obtain these files. Tie synchronization to upgrades of Stack's pinned Vite+: detect upstream editor-generator changes and require review of the owned settings, preserving deliberate differences for local Bun tooling and application lint policy. Do not automatically overwrite settings or update existing applications' editable files.
