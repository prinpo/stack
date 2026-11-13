import { createFileRoute } from "@prinpo/stack/react";

import { EnvironmentSandbox } from "../features/environment/view";

export const Route = createFileRoute("/")({ component: EnvironmentSandbox });
