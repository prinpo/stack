import { createFileRoute } from "@prinpo/stack/react";

import { InvitationView } from "../features/organizations/view";
export const Route = createFileRoute("/invitation")({ component: InvitationView });
