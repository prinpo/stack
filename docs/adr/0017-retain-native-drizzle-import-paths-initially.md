---
status: superseded by ADR-0018
---

# Retain native Drizzle import paths initially

This temporary exception is retired by [ADR 0018](0018-forward-drizzle-through-database-subpaths.md). The text below records the initial trade-off.

Initially retain `drizzle-orm/...` imports for the Database Block rather than mirroring Drizzle's dialect, driver, migrator, and validation entry points through Stack. This is a temporary exception to ADRs 0001 and 0002's reexport policy: accept reduced consistency across Blocks to avoid maintaining a large parallel export surface during the initial integration. Revisit the exception in a future database integration iteration.

Kit configuration is an exception to this exception: use Stack-owned `defineConfig` from `@prinpo/stack/database`, which preserves native settings while removing configurable output and enforcing project-root migrations. Stack still owns exact ORM/Kit versions and delivers them as dependencies; alternative external drivers remain application-owned. Qualify native import resolution, type inference, and use of the pinned dependencies in an independently installed consumer under the supported Bun/Vite+ toolchain. This decision does not assume that arbitrary package managers expose transitive dependencies or transfer ORM/Kit version ownership to applications.
