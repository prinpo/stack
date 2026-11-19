/** Reuse a persisted business result on retries and save before BullMQ records completion.
 * The application owns keys, transactions and concurrent-writer policy in save().
 * This does not make run() side effects exactly once.
 */
export async function withStoredResult<Result>({
  load,
  run,
  save,
}: {
  load(this: void): Promise<{ result: Result } | undefined>;
  run(this: void): Promise<Result>;
  /** Return the canonical persisted result, including when an upsert encounters a competing writer. */
  save(this: void, result: Result): Promise<Result>;
}): Promise<Result> {
  const stored = await load();
  return stored ? stored.result : save(await run());
}
