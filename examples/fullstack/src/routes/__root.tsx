import { TanStackRouterDevtools } from "@prinpo/stack/devtools";
import { Link, Outlet, createRootRoute } from "@prinpo/stack/react";

import { ApiProvider } from "../client";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  return (
    <ApiProvider>
      <main>
        <header>
          <p className="eyebrow">PRINPO / STACK</p>
          <h1>Prinpo Stack</h1>
          <p>Bun + Elysia + Eden + TanStack Router + Query</p>
          <nav>
            <Link to="/" activeOptions={{ exact: true }}>
              Environment sandbox
            </Link>
            <Link to="/queries">Queries and mutations</Link>
            <Link to="/auth">Authentication</Link>
            <Link to="/organizations">Organizations</Link>
            <Link to="/about">How it connects</Link>
          </nav>
        </header>
        <Outlet />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </main>
    </ApiProvider>
  );
}
