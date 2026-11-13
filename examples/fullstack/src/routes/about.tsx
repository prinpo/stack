import { createFileRoute } from "@prinpo/stack/react";

import { About } from "../features/about/view";

export const Route = createFileRoute("/about")({ component: About });
