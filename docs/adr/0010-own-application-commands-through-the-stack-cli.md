# Own application commands through the Stack CLI

Ship a local `stack` executable in `@prinpo/stack` to own repeated development, build, startup, logging, and environment workflows. Stack chooses conventional paths instead of introducing application configuration for the CLI. This replaces ADR 0003's assignment of development orchestration to application scripts while preserving native library configuration, independently usable Blocks, and direct Bun startup. The initial runtime target is Linux.

Keep CLI imports isolated from application runtime imports and run delegated JavaScript tools with Bun. Production may pay a small launch-time cost, but must gain no request handling or ongoing supervision from the CLI. Reuse the existing configuration lifecycle rather than resolving credentials twice; frontend-only applications use a lightweight Stack-owned Bun server with public dynamic configuration support.

Separate deployment profile selection through APP_ENV from runtime behavior through NODE_ENV and from Vite's native modes. Separate public build output in `dist/client` from backend code in `dist/server`. Publish `dist/manifest.json` only after a successful build and use it to select production startup, avoiding source-file requirements and stale-output inference.

The [CLI milestone](../milestones/0005-stack-cli.md) records the agreed command surface, defaults, lifecycle, and validation boundary. Interactive menus, database/auth commands, scaffolding, Docker workflows, and Windows support remain deferred.

[ADR 0015](0015-manage-development-compose-through-stack-dev.md) subsequently brings development Compose startup and shutdown into scope.
