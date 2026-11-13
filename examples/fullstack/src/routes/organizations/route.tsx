import { Outlet, createFileRoute } from "@prinpo/stack/react";
export const Route = createFileRoute("/organizations")({ component: Outlet });
