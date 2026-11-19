import { defineJobContext } from "@prinpo/stack/jobs";

import { openDatabase } from "../database/open";
import "../plugins/logging";

export const appJob = defineJobContext((resources) => {
  const { client, db } = openDatabase();
  resources.defer(() => client.close());
  return { db };
});
