# Project initializer editor settings and prompts

Research date: 2026-11-14. Research only; no implementation or workspace dependency installation. Read `AGENTS.md`, `CODING_STANDARDS.md`, the domain guide, root glossary, and ADRs 0003, 0010, and 0022. This note informs the empty-project `bunx @prinpo/stack init` design; it does not change the ADR or milestone.

**Pinned** means the published `vite-plus@1.2.0` tarball inspected in a temporary directory and its matching `v1.2.0` source tag (commit `882872042ce1a3424a82b976641bbe9099634d9b`). **Upstream** means source on `main` or live documentation inspected today, not the version promised by Stack. The checkout has no installed local `vp`; the reported `Script not found "vp"` is a missing executable, not evidence that Vite+ lacks `config`. The previous [local-toolchain research](vite-plus-local-toolchain.md) describes an earlier installed checkout. [Pinned npm metadata][npm], [pinned source][editor].

## Proposed choices

Keep **Citty for command routing** and add **`@clack/prompts` for initialization interaction**. Ask for the project name, then an optional editor multiselect with **Zed** and **VS Code**, allowing both or neither. Start with no checked editors; position the cursor on Zed if desired, without silently selecting it. Display that Space toggles and Enter accepts, including an explicit “leave empty to skip” explanation. These defaults are recommendations for Stack, not existing ADR requirements.

Ship small **Stack-owned editor configuration data**, aligned with pinned Vite+, rather than invoking `vp migrate` or importing Vite+'s private bundles. Retain `vp config --no-agent` for hook setup after local tooling installation, and generate Stack's own agent-documentation pointer. This satisfies ADR 0022's application-owned configuration and local-tooling requirements without bringing application source or a Vite+ template into initialization. [ADR 0022](../adr/0022-initialize-empty-projects-with-local-tooling.md), [pinned config entry][config], [package exports][manifest].

The tradeoff: Stack must review these small editor files when updating its tested toolchain. Copying upstream source also requires retaining applicable license/attribution; Vite+'s CLI package declares MIT. Treat the generated files as application-owned after initialization. [Pinned CLI manifest][manifest].

## What Vite+ actually generates

`vp config` in 1.2.0 installs the Git hook dispatcher and refreshes recognized existing agent instruction blocks unless `--no-agent` is passed. It has **no editor-generation step**. `--no-hooks` is separate and does not disable agent refresh. Upstream's config entry still has no editor generator. Therefore `bun --bun vp config --no-agent` preserves Stack's agent file but cannot implement the editor selection. [Pinned config][config], [upstream config][config-main], [agent updater][agent].

Create and migrate share `packages/cli/src/utils/editor.ts`. Its choices are `vscode`, `zed`, and `jetbrains`, with deprecated aliases `intellij` and `webstorm`. Create uses `selectEditors` (multiselect, initially VS Code checked, `required: false`); migrate uses `selectEditor` (single choice, initially VS Code, with Other to skip). `writeEditorConfigs` itself accepts one editor or an array. These are internal source functions, **not supported public exports** of `vite-plus`; even `vite-plus/internal` re-exports Vite internals rather than the editor utilities. The shipped function is in a hashed bundle with unrelated migration code and native/dependency imports. An absolute-path import into that bundle is technically possible but unsuitable as a stable integration. [Pinned generator][editor], [create entry][create], [migration entry][migrate], [package exports][manifest], [internal entry][internal].

| Choice    | Files and behavior in 1.2.0                                                                                                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zed       | `.zed/settings.json`; Oxlint on type, safe fixes, `typeAware: true`, `unusedDisableDirectives: "deny"`; Oxfmt points at `./vite.config.ts` and runs on save. Seventeen language entries disable Prettier and select Oxfmt; only JavaScript additionally has `source.fixAll.oxc`.                     |
| VS Code   | `.vscode/settings.json` and `extensions.json`; Oxc formatter, JS/TS language overrides, full-file format-on-save, explicit Oxc fix-all, nested config disabled, and `VoidZero.vite-plus-extension-pack` recommendation. Create adds `npm.scriptRunner: "vp"`; migrate does not.                      |
| JetBrains | `.idea/externalDependencies.xml`, `workspace.xml`, `OxfmtSettings.xml`; plugin recommendation, runtime/package-manager paths, Oxfmt preference. Its generated Node interpreter path points into Vite+'s machine-level directories, which is an additional mismatch for Stack's local-only Bun setup. |

Source: [pinned generator][editor] and [create integration][create]. Editor extension installation remains a separate user action; writing a recommendation is not installing an extension. [Official IDE guide][ide].

For Stack, offer Zed and VS Code first; defer JetBrains unless requested and its runtime-path semantics are designed. Avoid `npm.scriptRunner: "vp"` initially: its bare executable is an extra editor integration assumption, while Stack can document application scripts through Bun. The essential VS Code formatter settings do not need that option. Validate editor extension discovery of the project-local tooling separately; CLI execution under Bun does not establish extension behavior.

### Existing Zed file

Read the existing [.zed/settings.json](../../.zed/settings.json) without modifying it. A reconstruction of the pinned generator's literal, including all seventeen language entries, compares equal to the parsed file. That is strong evidence of **generator-compatible contents**, but not proof of who or which command created it: Git only shows it arriving in the initial commit, and it could have been copied from documentation. Nothing in `vp config` explains its creation. [Pinned generator][editor], [config][config].

Upstream `main` has already removed the forced `typeAware` and `unusedDisableDirectives` settings from this generator, leaving these policies to project lint configuration. Do not silently mix that newer behavior into a claimed 1.2.0 reproduction; decide whether Stack should deliberately follow its application `lint.options` instead. [Upstream generator][editor-main].

### Noninteractive controls and file conflicts

Both pinned create and migrate expose `--editor NAME`, `--no-editor`, `--interactive`, `--no-interactive`, and `--no-agent`. **Repeated `--editor` flags do not select multiple editors:** argument collection permits repetition, but the shared Rust `editor_option` returns only the final string. The parser tests explicitly assert last-value-wins. A comma-separated list is also unsupported by the resolver. With no explicit editor and no interaction, selection returns no editor. These are native flags for the full workflows, not an editor-only command. [Create parser][create-args], [migrate parser][migrate-args], [shared argument conversion][common], [resolver][editor].

In principle `bun --bun vp migrate --no-interactive --no-agent --editor zed` can write settings using an installed project-local CLI; **do not use this as an editor helper**. Migration also handles dependencies, scripts, tool configuration, hooks, installation and formatting. Likewise, create scaffolds a template. `--no-agent` excludes agent generation, not those other changes. There is no documented editor-only subcommand or exported generator API in the inspected release. [Migration entry][migrate], [create entry][create], [local CLI guide][local].

For existing JSON/JSONC editor files, the generator can add missing keys while preserving existing values, comments and untouched formatting; extension recommendations are appended without duplicates. Arrays in general settings are retained, not combined. Interactive conflicts default to Skip; noninteractive JSON conflicts default to Merge. Existing XML defaults to Skip outside interaction, while the interactive choice can replace it. This is relevant if initialization later permits nonempty targets; a genuinely empty target needs no merge implementation. [Generator conflict handling][editor].

## Prompt libraries and Citty

Citty already owns Stack's `defineCommand`, arguments, help and subcommand dispatch. Its API addresses command parsing and routing, while prompt libraries supply terminal interaction inside a command's run function. Keep that boundary; load the prompt library only on the initializer path. Neither candidate requires replacing Citty. [Stack entry](../../src/cli/main.ts), [Citty documentation][citty].

| Concern                 | `@clack/prompts`                                                                                                                     | `@inquirer/prompts`                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Name input              | `text({ validate })`; return an error message for invalid input.                                                                     | `input({ validate })`; return true or an error message, with async validation supported.                                           |
| Optional editor choices | `multiselect({ options, required: false, initialValues: [] })`; empty selection is supported. `required` otherwise defaults to true. | `checkbox({ choices, required: false })`; no checked choices and no minimum gives an empty array.                                  |
| Cancellation            | A cancellation symbol; inspect with `isCancel` after each prompt before using the answer. `cancel()` renders a message.              | Ctrl+C rejects with `ExitPromptError`; handle it at the command boundary. Abort signals also support programmatic cancellation.    |
| Non-TTY                 | The core builds terminal readline/raw-key interaction; it does not supply Stack's noninteractive argument/default policy.            | Official docs require an interactive input stream for keypress prompts; custom streams do not create a sensible unattended policy. |
| Fit here                | A cohesive sequential initializer UI; directly matches Vite+'s optional editor multiselect.                                          | Equally capable for these prompts; more granular prompt modules and runtime context options if needed later.                       |

Primary API/source evidence: [Clack guide][clack], [Clack multiselect][clack-multi], [Clack core][clack-core], [Inquirer input][input], [Inquirer checkbox][checkbox], [Inquirer cancellation/context and noninteractive guidance][inquirer].

Guard interaction in Stack **before invoking either library**, using input/output terminal availability and an explicit CI/noninteractive policy. Vite+'s own default is `!process.env.CI && process.stdin.isTTY`; this policy lives in Vite+, not Clack. Recommended behavior: fail early with actionable instructions when required answers are missing outside a terminal; never hang or treat cancellation as “no editors.” Decide whether this milestone exposes argument-based unattended initialization or merely reports that an interactive terminal is required. [Pinned Vite+ interaction policy][prompts].

### Bun compatibility and actual adoption

Both candidates ran in temporary-package smoke probes under **Bun 1.4.4 on Linux**, using **Clack 1.9.0** and **Inquirer prompts 8.8.0**. For each library, a pseudo-terminal probe rejected a blank name, accepted `project-name`, accepted an empty editor selection, and handled Ctrl+C through its documented mechanism. This is concrete compatibility evidence for these operations, not a full platform guarantee. Inquirer's official README also documents `bun add @inquirer/prompts`; an installation example alone would not establish runtime compatibility. [Inquirer README][inquirer].

The first Inquirer text probe sent invalid input and the next answer in one immediate burst; it did not finish within the probe timeout. Repeating with pauses between validation and subsequent typing passed. The probes establish ordinary interactive behavior; they do not establish reliable bulk-piped answers, so use explicit arguments for automation rather than piping keystrokes.

Primary adoption evidence, without a popularity ranking:

- **Clack:** create-vite imports and calls `@clack/prompts`, and its manifest declares it. Vite+'s pinned prompt utility also imports Clack. These are relevant scaffold/toolchain precedents. [create-vite implementation][vite-use], [create-vite manifest][vite-package], [Vite+ prompt utility][prompts].
- **Inquirer prompts:** Angular CLI declares `@inquirer/prompts` and its terminal-guarded utilities dynamically import and invoke `confirm`, `select` and `checkbox`. This is evidence for the modern scoped package, rather than conflating it with historical `inquirer` adoption. [Angular manifest][angular-package], [Angular prompt utilities][angular-use].

## Decisions still to resolve

1. **Name semantics:** does “project name” determine a new child directory and package name, or only name an empty current directory? Decide scoped names, path traversal/separators, invalid package names, collisions, and whether `.` is accepted. Validate the final derived target before writing anything.
2. **Editor defaults and scope:** accept the proposed unchecked Zed/VS Code list, preselect Zed, or mirror upstream's VS Code default? Do not infer editor preference from unrelated ancestor settings. Decide whether the pinned Zed lint overrides should be retained or deliberately omitted in favor of application lint policy.
3. **Noninteractive contract:** require a TTY for v1, or define explicit name/directory and editor flags, including an unambiguous no-editor value? If flags exist, Stack should genuinely support multiple editors and reject unknown IDs rather than inherit Vite+'s last-value behavior.
4. **Target safety and cancellation:** recommend collecting and validating both answers before creating the project, with a clear cancellation exit status. Decide how to recognize “empty” when dotfiles exist, and whether existing editor settings require rejection, skip, or explicit merge. Preserve the existing repository Zed file throughout this design work.
5. **Editor template ownership:** approve versioned Stack-owned data, or seek a supported upstream export/editor-only command before implementation. A private bundle import would create an unsupported dependency seam. Document extension requirements and verify installed editor integration without a global `vp`.

## Verification and limits

Downloaded and inspected the published Vite+ tarball and primary source files in `/tmp`; installed only the two prompt libraries in an isolated temporary probe package. No workspace dependencies installed, no `vp config/create/migrate` executed, no editor files written, and no ADR/milestone changes made. Full project checks/tests were not run because this is a research-only Markdown addition and the checkout lacks dependencies. Compared the existing Zed JSON structurally to pinned generator data and inspected the manifest/export map and native parser tests.

[npm]: https://registry.npmjs.org/vite-plus/1.2.0
[editor]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/utils/editor.ts
[editor-main]: https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/src/utils/editor.ts
[config]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/config/bin.ts
[config-main]: https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/src/config/bin.ts
[agent]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/utils/agent.ts
[manifest]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/package.json
[internal]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/internal.ts
[create]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/create/bin.ts
[migrate]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/migration/bin.ts
[create-args]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/binding/src/js_command_args/commands/create.rs
[migrate-args]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/binding/src/js_command_args/commands/migrate.rs
[common]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/binding/src/js_command_args/commands/common.rs
[ide]: https://viteplus.dev/guide/ide-integration
[local]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/docs/guide/local-cli.md
[citty]: https://github.com/unjs/citty/blob/main/README.md
[clack]: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md
[clack-multi]: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/src/multi-select.ts
[clack-core]: https://github.com/bombshell-dev/clack/blob/main/packages/core/src/prompts/prompt.ts
[inquirer]: https://github.com/SBoudrias/Inquirer.js/blob/main/packages/prompts/README.md
[input]: https://github.com/SBoudrias/Inquirer.js/blob/main/packages/input/README.md
[checkbox]: https://github.com/SBoudrias/Inquirer.js/blob/main/packages/checkbox/README.md
[prompts]: https://github.com/voidzero-dev/vite-plus/blob/v1.2.0/packages/cli/src/utils/prompts.ts
[vite-use]: https://github.com/vitejs/vite/blob/main/packages/create-vite/src/index.ts
[vite-package]: https://github.com/vitejs/vite/blob/main/packages/create-vite/package.json
[angular-package]: https://github.com/angular/angular-cli/blob/main/packages/angular/cli/package.json
[angular-use]: https://github.com/angular/angular-cli/blob/main/packages/angular/cli/src/utilities/prompt.ts
