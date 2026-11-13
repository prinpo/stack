import { createFileRoute } from "@prinpo/stack/react";

import { OrganizationView } from "../../features/organizations/view";
export const Route = createFileRoute("/organizations/$slug")({ component: OrganizationPage });
function OrganizationPage() {
  return <OrganizationView slug={Route.useParams().slug} />;
}
