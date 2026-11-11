# Stack owns its library dependencies

Applications should share a consistent set of library versions and need little dependency setup. Stack declares the libraries it integrates as regular dependencies and exposes them through its public import paths; React and React DOM remain optional peer dependencies so the consuming application owns their shared instances. UI consumers install compatible React and React DOM versions; backend-only consumers can use server entry points without installing either. This chooses simpler installation and centrally managed versions over application-level version control and installing only the libraries used by a particular application.

A frontend-only application therefore still installs Stack's backend dependencies. Blocks must remain independently usable despite sharing a dependency installation; installation independence is not a requirement.

Pin integrated libraries to exact versions and upgrade them as a tested set. Stack maintainers own dependency updates, including vulnerability fixes, and publish new Stack versions to deliver them. Consuming applications can temporarily override dependency versions through their package manager; those overrides depart from Stack's tested dependency set. React and React DOM peers use supported version ranges.

[ADR 0018](0018-forward-drizzle-through-database-subpaths.md) retires Drizzle’s temporary native-import exception: database APIs now follow the same Stack reexport policy, including matching ORM subpaths.
