import { createFileRoute } from "@prinpo/stack/react";

export const Route = createFileRoute("/about")({ component: About });

function About() {
  return (
    <section>
      <p className="eyebrow">FILE-BASED ROUTING</p>
      <h2>A few small pieces.</h2>
      <ol>
        <li>
          Varlock demonstrates public/secret and static/dynamic configuration on the landing page.
        </li>
        <li>The Stack Vite preset connects React, route generation, and the API proxy.</li>
        <li>Elysia defines the API. Eden infers its contract from a type-only import.</li>
        <li>Router prefetches typed query options into the shared TanStack Query cache.</li>
        <li>The Eden Query connector supplies query keys, mutations, and infinite queries.</li>
        <li>The serving plugin connects the browser build to Elysia for production.</li>
      </ol>
    </section>
  );
}
