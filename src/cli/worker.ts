import { defineCommand, showUsage } from "citty";

import { readBuildManifest } from "../build-manifest";
import { builtDatabase } from "../database/files";
import { environment, profileArgs, takeOptions } from "./options";
import { builtWorkerEntry } from "./project";

const worker = defineCommand({
  meta: { name: "worker", description: "Run a built jobs worker in production" },
  args: {
    ...profileArgs,
    check: {
      type: "boolean",
      description: "Verify worker readiness, then exit before consuming jobs",
    },
  },
  async run({ rawArgs }) {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await showUsage(worker, { meta: { name: "stack" } });
      return;
    }
    const { values, rest } = takeOptions(rawArgs, ["env"], ["check"]);
    if (rest.length) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
    const manifest = readBuildManifest();
    const entry = builtWorkerEntry(manifest);
    builtDatabase(manifest);
    const env: NodeJS.ProcessEnv = environment(
      typeof values.env === "string" ? values.env : undefined,
      "production",
    );
    if (values.check) env._STACK_JOBS_CHECK = "1";
    env._STACK_DATABASE_BUILT = "1";
    const inherited = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    process.execve!(process.execPath, [process.execPath, "--no-env-file", entry], inherited);
  },
});
export default worker;
