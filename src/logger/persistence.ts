import { type DrainContext } from "evlog";
import { type FsConfig, createFsDrain } from "evlog/fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

/** Use evlog's writer/rotation, retaining files by actual write time rather than reused suffixes. */
export function developmentDrain(options: Partial<FsConfig> = {}) {
  const dir = resolve(options.dir ?? ".evlog/logs");
  const maxFiles = options.maxFiles ?? 5;
  // Native cleanup sorts suffixes and can immediately delete a newly recreated base file.
  const write = createFsDrain({ maxSizePerFile: 10 * 1024 * 1024, ...options, dir, maxFiles: 0 });
  let pending = Promise.resolve();
  return (context: DrainContext) => {
    const next = pending.then(async () => {
      await write(context);
      if (maxFiles <= 0) return;
      const names = await readdir(dir).catch(() => []);
      const files = await Promise.all(
        names
          .filter((name) => /^\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl$/.test(name))
          .map(async (name) => {
            const path = resolve(dir, name);
            return { path, time: (await stat(path, { bigint: true })).mtimeNs };
          }),
      );
      files.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      await Promise.all(
        files.slice(0, Math.max(0, files.length - maxFiles)).map(({ path }) => unlink(path)),
      );
    });
    pending = next.catch(() => {});
    return next;
  };
}
