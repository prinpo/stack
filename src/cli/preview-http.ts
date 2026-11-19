import { pathToFileURL } from "node:url";

import { startFrontend } from "../start-frontend";

// Stack backend entries await startServer, including migrations and opening the listener.
const entry = process.argv[2];
if (entry) await import(pathToFileURL(entry).href);
else await startFrontend();
process.send!("stack:http-ready");
