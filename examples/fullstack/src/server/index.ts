import { serveApp } from "@prinpo/stack/server";

import { app } from "./app";

if (process.env.NODE_ENV === "production") app.use(serveApp());

app.listen(3000);
console.log(`API listening at ${app.server?.url}`);
