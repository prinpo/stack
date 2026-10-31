# Stack CLI

The agreed CLI is implemented. The following boundary remains its implementation contract; qualification results are recorded below. [ADR 0010](../adr/0010-own-application-commands-through-the-stack-cli.md) records the architectural choices.

## Purpose and structure

Provide one local `stack` executable through the installed `@prinpo/stack` package. Simplify repeated application workflows while delegating native operations to the tested underlying tools. Use citty for parsing and help, with lazily loaded command modules. Bare `stack` prints help; interactive selection is deferred.

Group development, build, and startup commands in one lifecycle module. Environment commands and logs each have their own module; structural diagnosis is a separate command. Adding an area should require registering its commands, without introducing a plugin framework.

Run the executable and delegated JavaScript tooling with Bun, including tools whose upstream shebang selects Node. Resolve installed tools rather than downloading tooling during ordinary commands. Keep CLI imports out of application runtime imports. Target Linux initially; Windows support is deferred, and macOS is not part of this milestone's qualification.

## Conventions and capability detection

Stack owns defaults rather than requiring a CLI configuration file or layout override flags:

- Root `index.html` enables frontend development and builds.
- `src/server/index.ts` enables backend development and builds.
- Both enable the full-stack lifecycle; neither produces an actionable error.
- Client and application server schemas live at `env/client` and `env/server`.
- Browser output lives in `dist/client`; backend output lives in `dist/server`, with entry `dist/server/index.js`.

Native Vite configuration and lower-level runtime helpers remain usable. A detected capability that fails must not silently become disabled. Production capability selection comes from the successful build manifest, not source-file presence or leftover output files.

## Environment profiles

Stack owns APP_ENV alongside HOST, PORT, and NODE_ENV. APP_ENV selects deployment configuration files; NODE_ENV controls runtime behavior. APP_ENV defaults to NODE_ENV. Keep Vite's native mode independent: Vite mode must not implicitly choose or overwrite APP_ENV.

Use consistent `--env` profile selection across applicable lifecycle, environment, and logs commands, with precedence: explicit flag, genuine inherited APP_ENV, then command default. Keep the implementation shared and small. `dev` uses NODE_ENV=development; `build` and `start` use NODE_ENV=production. Thus `stack start --env staging` uses staging values while retaining production serving and logging behavior. Environment utilities retain native runtime behavior rather than forcing production mode.

Propagate the selected profile consistently through server loading, client static compilation, and client dynamic HTML hydration. Do not pass a fully resolved server credential graph to Vite merely to select a profile. Reuse native Varlock selection and configuration loading rather than creating a custom resolver. Existing startup must continue to avoid resolving providers twice. Replace the example's obsolete production profile wrapper with the managed workflow as appropriate.

## Development

`stack dev` launches only detected capabilities through native Vite+ and Bun watching. Treat them as one session: interrupting stops all children; an unexpected process exit stops its siblings and fails the command. Leave ordinary code-change handling to native watchers.

Add a small built-in filesystem watcher for existing conventional environment directories. Any backend environment-file change restarts both development processes, refreshing Vite's proxy connection/profile as well as server configuration. Leave client changes to the existing Vite integration. Document manual restart for external schema imports and newly created directories; do not build a general reload framework.

## Builds and production startup

`stack build` validates static inputs and builds detected capabilities without deployment credentials or dynamic provider calls. Clear the previous successful-build manifest and both Stack-owned output directories before building. Write `dist/manifest.json` only after all selected build work succeeds, recording frontend/backend capabilities. Failed builds must not leave a manifest that advertises success.

`stack start` reads the manifest, validates its advertised artifacts, and fails with an actionable rebuild instruction if metadata or required artifacts are absent or invalid. Do not guess capabilities from stale files or downgrade to another application shape. Source files are not needed for production capability detection; runtime schemas, dependencies, and other required assets still are.

Backend and full-stack startup launch `dist/server/index.js`. Frontend-only startup uses Stack-owned `Bun.serve` over `dist/client`. Keep the frontend runtime lightweight while supporting assets, HEAD requests, SPA navigation fallback, missing-asset 404s, and public dynamic configuration injected into HTML before application modules run. Prepare deployment-specific HTML at startup with no-store behavior, keeping build artifacts unchanged. Never serve backend artifacts as public assets.

Frontend-only startup resolves hosting settings and public client configuration without requiring unrelated backend credentials. Static browser values remain compiled build values. Full-stack and frontend-only browser serving should agree on these behaviors.

Production CLI work is limited to launch: no added request handling or ongoing supervision. Use Linux process handoff rather than retaining a CLI parent where appropriate. Direct Bun server startup remains supported. Container-specific deployment workflows are deferred.

## Environment commands

Initially expose only:

```sh
stack env load
stack env codegen
stack env run -- bun scripts/example.ts
```

Preserve the selected native Varlock operations, names, options, and output, including agent output where supported. Other Varlock utilities remain deferred.

Inspection and execution default to the effective server graph: Stack-owned settings plus application server configuration. `--client` selects the independent client schema. Codegen targets both existing schemas by default, with `--server` and `--client` for explicit selection. Skip absent optional directories during default generation; explicitly selected missing schemas and invalid existing schemas fail. Preserve native failures for existing schemas that cannot generate types.

## Logs

Expose native evlog viewing, selectors, and filtering through `stack logs`, including `errors`, request IDs, JSON output, and following. Preserve native exit statuses, one-shot JSON result objects, and newline-delimited JSON events when following. Keep Stack diagnostics out of machine-readable stdout. Scope viewing to local logs; production aggregation is deferred.

Rename PRINPO_LOG_DIR to LOG_DIR throughout active application configuration, generated types, commands, examples, and documentation. Developer-facing configuration names must not carry branding; internal Elysia plugin identifiers may retain it. Package names and product prose are not part of this configuration rename.

Directory precedence is explicit `--dir`, then the selected profile's LOG_DIR, then `.evlog/logs`. An explicit directory skips environment lookup. Otherwise resolve only the required setting, without validating unrelated credentials. Preserve the existing disabled CLI telemetry policy.

## Doctor

`stack doctor` scans project structure and reports detected capabilities with explanations, such as frontend disabled because `index.html` is missing. Include schema-directory presence. Provide readable output and `--json` for agents. It performs no network checks, starts no application processes, and resolves no environment values or credentials. Missing optional capabilities are informational; neither application entry point produces a nonzero exit status.

## Validation and migration

Verify full-stack, frontend-only, and backend-only lifecycles through the public command surface. Cover failed builds and stale artifacts, production startup without source entry files, native tool execution under Bun, process cleanup, and backend-env session restarts. Check machine-readable logs and doctor output without stdout contamination.

Verify production builds and frontend-only serving remain credential-free at build time, resolve dynamic values at startup, and serve the same artifact under different profiles. Verify APP_ENV independently of NODE_ENV and Vite mode, including staging startup with production behavior. Retain public-only client validation and existing static/dynamic safeguards.

Update example scripts, output/serving defaults, generated environment types, and active guides together. Check installed executable resolution as well as workspace invocation; existing Varlock root-patch requirements remain explicit, and must not be silently treated as transitive package behavior. No unrelated package-distribution redesign is included.

Run repository-required `vp check`, `vp test`, and relevant example validation after implementation. Implementation follows the authorized design boundary.

## Deferred

Interactive menus and prompt dependencies; database/auth commands; application scaffolding; a dedicated CLI config file and layout override flags; a command plugin framework; additional Varlock utilities; broad environment import watching; remote log aggregation; Docker workflows; Windows support.

## Implemented qualification

The full suite passes: 644 tests across 43 files, including 21 public CLI integration tests. `vp check`, `vp run example:check`, and the full-stack example build pass. Real HTTP checks cover production hydration, private backend output, and Linux process handoff. An isolated tarball consumer verifies the installed executable and bunx resolution, native JSON logs, staging client configuration, source-free startup, and invalidation of an inherited development snapshot when starting production with staging values. The consumer applies the required Varlock patch explicitly at its root.

The source-linked example uses one `stack` script pointing to the live source executable because Bun does not link the root package's own binary in this workspace. Independently installed packages expose the ordinary local binary. CLI profiles and conventional client paths use small scoped additions to the existing pinned Varlock core patch; native resolution remains upstream-owned.

Standards review: no hard violations; two maintainability findings resolved by sharing server graph paths and SPA navigation/shell policy. The latter was the more consequential duplication because it could make the two production servers disagree.

Spec review: two correctness findings resolved with regression tests. Incompatible inherited snapshots can no longer override an explicit startup mode/profile, and directories cannot stand in for advertised entry files. The snapshot issue was the higher-severity finding. No review findings remain open.

## Terminal presentation follow-up

Human development, build, and doctor commands show a dimmed Prinpo Stack/version intro. Chalk supplies automatic terminal colors with NO_COLOR support. Doctor groups capabilities and schema presence with clear enabled/disabled indicators; JSON remains undecorated. Developer-configurable names remain unbranded.

Development labels each frontend/backend stdout and stderr line with a distinct colored process name, preserving native colors in terminals and flushing partial final lines. Process cleanup and environment-triggered restarts retain their existing behavior. Builds use the same labels plus separate area headings, then summarize enabled output sizes, validation/build durations, Stack version, profile, and total time. Output sizes exclude external dependencies.

The example keeps only stack (the source-workspace shim) and check scripts. Root convenience commands and active documentation use the CLI directly.

Terminal follow-up validation passes: 646 tests across 43 files (23 CLI integration tests), root formatting/lint/types, example checks, and an example build. A real terminal check verifies color and dimmed branding; forced-color doctor JSON stays clean on both streams. Standards review's one duplicated presentation mapping is now shared; Spec review found no issues. A separate failure probe retained 20,000 child-output lines and its final diagnostic, preserved exit status 7, and emitted no success summary.
