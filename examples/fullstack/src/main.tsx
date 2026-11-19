import { createRootAndRender, createRouter } from "@prinpo/stack/react";

import { i18n } from "./i18n/client";
import { routeTree } from "./routeTree.gen";
import "./style.css";

const router = createRouter({ routeTree, ...i18n.routerOptions() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRootAndRender(router);
