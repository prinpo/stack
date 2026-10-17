import { type AnyRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

export * from "@tanstack/react-router";

export function createRootAndRender(router: AnyRouter) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing application root");

  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
