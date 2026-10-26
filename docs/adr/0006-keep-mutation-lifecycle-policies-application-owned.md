# Keep mutation lifecycle policies application-owned

Use TanStack Query's native MutationCache callbacks for client-wide mutation behavior and reusable mutation options with application-defined `meta` for per-mutation configuration. Applications own notifications, translation, logging, and other policies. Stack introduces no additional mutation lifecycle abstraction; native Query already supports this pattern, including through Eden's mutation options.

Defer the application feedback example and backend error identification/action helpers until Elysia is integrated with evlog and its error contract is verified through Eden. Keep these helpers headless and leave presentation and application actions to consumers. See [deferred work](../eden-query.md#deferred-backend-errors-and-mutation-feedback) for the follow-up sequence.
