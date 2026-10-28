import { TanStackRouterDevtools } from "@prinpo/stack/devtools";
import { Link, Outlet, createRootRoute } from "@prinpo/stack/react";

import { ApiProvider } from "../client";
import { ENV } from "../env/client";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  return (
    <ApiProvider>
      <main>
        <header>
          <p className="eyebrow">PRINPO / STACK</p>
          <h1>{ENV.APP_TITLE}</h1>
          <p>Deployment: {ENV.PUBLIC_DEPLOYMENT_NAME}</p>
          <p>Bun + Elysia + Eden + TanStack Router + Query</p>
          <nav>
            <Link to="/" activeOptions={{ exact: true }}>
              Home
            </Link>
            <Link to="/about">How it connects</Link>
          </nav>
        </header>
        <Outlet />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </main>
    </ApiProvider>
  );
}
