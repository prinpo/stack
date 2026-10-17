# Maintain an attributed Eden Query connector

Stack maintains a near 1:1 adaptation of eden-tanstack-react-query v0.5.0 so its releases can own connector fixes and qualify the exact Elysia, Eden, and TanStack Query dependency set together. Preserve the upstream public functions and route-based options, keys, filters, and infinite queries during this initial import; review and simplify them in later work. Credit Ilya Zhidkov and contributors, retain Apache-2.0 and modification notices, and track the baseline and changes in `src/eden-query/README.md`.

Expose this opt-in Block and native TanStack React Query exports through `@prinpo/stack/query`, with Query pinned as a regular Stack dependency. Keep the existing Eden, Router, and server entry points independently usable. This advances beyond the first milestone's Query deferral in ADR 0002; SSR and production qualification remain outside this initial connector step.
