# Initialize projects with a TanStack Router frontend

Stack uses file-based routing for new frontends, so `stack init` creates a runnable frontend with a browser entry, a root route, and a sample home route. The Vite preset generates the route tree and shares the route map with the code splitter.

This revises the source scope of [ADR 0022](0022-initialize-empty-projects-with-local-tooling.md). The initializer continues to install the version-matched local toolchain and configure Git and editors. Applications add backend and worker entry points when needed.
