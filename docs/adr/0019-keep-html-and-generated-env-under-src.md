# Keep HTML and generated environment modules under src

Require the browser entry at `src/index.html` and generated Varlock modules inside `src/env-gen/` so application source and generated accessors are easy for humans and agents to find. Keep native tool configuration, environment schemas, and Drizzle migrations at the project root. This narrows ADR 0002’s flexible application layout and updates ADR 0010’s frontend convention; Stack does not enforce the example’s server architecture.

Use `src/` as Vite’s root while retaining application-root config discovery, schema loading, router paths, cache paths, and `dist/client` output. Reject nonliteral generation paths and destinations outside `src/env-gen/` before value resolution or file generation. The example groups server route apps, plugins, validation schemas, and database modules in separate directories, leaving only composition and startup files directly under `src/server/`.

Existing apps must move the HTML entry, update script/public asset paths, and change generation annotations and imports before regenerating environment modules. Built production artifacts keep their existing layout and remain startable without source entries.
