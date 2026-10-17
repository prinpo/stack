import { createRootAndRender, createRouter } from "@prinpo/stack/react";

import { routeTree } from "./routeTree.gen";
import "./style.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRootAndRender(router);
