import { createFileRoute } from "@prinpo/stack/react";

import { ResetPasswordView } from "../features/auth/reset-view";
export const Route = createFileRoute("/auth/reset")({ component: ResetPasswordView });
