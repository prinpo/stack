import { createRouter, RouterProvider } from "@prinpo/stack/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import "./style.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
