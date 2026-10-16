import { TanStackRouterDevtools } from "@prinpo/stack/devtools";
import { createRootRoute, Link, Outlet } from "@prinpo/stack/react";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  return (
    <main>
      <header>
        <p className="eyebrow">PRINPO / STACK</p>
        <h1>One connected application.</h1>
        <p>Bun + Elysia + Eden + TanStack Router</p>
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
  );
}
