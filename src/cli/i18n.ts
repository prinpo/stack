import { defineCommand } from "citty";

import { runBun, tool } from "./tools";

export default defineCommand({
  meta: { name: "i18n", description: "Native General Translation workflows" },
  async run({ rawArgs }) {
    await runBun([tool("gt", "gt"), ...(rawArgs.length ? rawArgs : ["--help"])], process.env);
  },
});
