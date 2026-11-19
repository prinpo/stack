# Run independent workers with native JSON results

Supersede ADR 0022’s original in-process consumption decision. HTTP hosts are producers. `stack dev` owns one development session with a dedicated worker process whenever `src/server/worker.ts` exists. Production starts the same worker entry with `stack worker`. Worker hosts retain producers for follow-up jobs.

Keep native JSON transport and map client results to JsonResult, including Date/nonfinite-number nullability and root void normalization, instead of adding a rich-value protocol. Handler values remain native until transport. Durable business results belong in application storage. Each typed run call gets a fresh ID to correlate completion with its execution. Custom job IDs and deduplication are available on add.

Package the shared application module tree under dist/server/src so processor URLs and deferred imports survive production deployment for both entries. One image can run HTTP and independently scaled worker commands. Applications own database transactions, clients and conflict policy. Rolling-deployment contract compatibility remains deferred.

Use one exported queue registry shared by both entries. Each queue owns its native worker settings and can read concurrency through the application’s environment schema. Jobs can share typed resources initialized once per worker host with `defineJobContext`. Optional BullMQ subprocess and thread sandboxes use the queue module’s URL, validate its default export before consumption, and initialize and dispose their own shared context. The registry’s static imports determine build inputs.

Version 2 build manifests describe the worker and shared module layout. A non-consuming worker check exercises deployment configuration, Redis, and processor initialization. Polling uses a single stored job record to report pending, completed, failed or missing with a matching typed result.
