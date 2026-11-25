import { createFileRoute } from "@prinpo/stack/react";

import { About } from "../features/about/view";
import { i18n } from "../i18n/client";

export const Route = createFileRoute("/about")({ component: LocalizedAbout });

function LocalizedAbout() {
  const locale = i18n.useLocale();
  const canonical = new URL(i18n.localePath("/about", locale), window.location.origin);
  return (
    <>
      <link rel="canonical" href={canonical.href} />
      <About />
    </>
  );
}
