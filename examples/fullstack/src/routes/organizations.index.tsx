import { createFileRoute } from "@prinpo/stack/react";

import { OrganizationsView } from "../features/organizations/view";
export const Route = createFileRoute("/organizations/")({ component: OrganizationsView });
