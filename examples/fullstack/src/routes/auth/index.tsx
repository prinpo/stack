import { createFileRoute } from "@prinpo/stack/react";

import { AuthView } from "../../features/auth/view";
export const Route = createFileRoute("/auth/")({ component: AuthView });
