# Keep mutation lifecycle policies application-owned

Use TanStack Query's native MutationCache callbacks for client-wide mutation behavior and reusable mutation options with application-defined `meta` for per-mutation configuration. Applications own notifications, translation, logging, and other policies. Stack introduces no additional mutation lifecycle abstraction; native Query already supports this pattern, including through Eden's mutation options.

Defer the application feedback example and backend error identification/action helpers until Elysia is integrated with evlog and its error contract is verified through Eden. Keep these helpers headless and leave presentation and application actions to consumers. See [deferred work](../eden-query.md#deferred-backend-errors-and-mutation-feedback) for the follow-up sequence.

The [evlog milestone design](../milestones/0003-evlog.md) now includes a basic structured-error guard with the integration, usable inside native Query callbacks. Application actions and the feedback example remain deferred; this introduces no new mutation lifecycle abstraction.
