import { useMutation, useQuery } from "@prinpo/stack/query";
import { createFileRoute } from "@prinpo/stack/react";
import { useState } from "react";

import { eden } from "../client";
import { ENV } from "../env/client";

export const Route = createFileRoute("/")({ component: EnvironmentSandbox });

function EnvironmentSandbox() {
  const serverEnv = useQuery({ ...eden.env.get.queryOptions(), enabled: false });
  const notes = useQuery(eden.notes.get.queryOptions());
  const [text, setText] = useState("");
  const addNote = useMutation(
    eden.notes.post.mutationOptions({
      onSuccess: async () => {
        setText("");
        await notes.refetch();
      },
    }),
  );

  return (
    <>
      <section>
        <h2>Persistent notes</h2>
        <p>Notes are stored in SQLite and remain available after the server restarts.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addNote.mutate({ text });
          }}
        >
          <label>
            Note{" "}
            <input
              value={text}
              maxLength={500}
              onChange={(event) => setText(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={addNote.isPending}>
            {addNote.isPending ? "Saving…" : "Save note"}
          </button>
        </form>
        {(notes.isError || addNote.isError) && (
          <p role="alert">
            Could not load or save notes. Check the server and apply development migrations.
          </p>
        )}
        <ul>
          {notes.data?.map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      </section>
      <section>
        <p className="eyebrow">VARLOCK ENVIRONMENT SANDBOX</p>
        <h2>Browser environment</h2>
        <p>
          Both values live beside their schema in <code>env/client/</code>. Static values are baked
          into the browser build. Vite reads dynamic values from files during development;
          production startup injects them into HTML.
        </p>
        <dl className="env-values">
          <dt>
            <code>CLIENT_PUBLIC_STATIC</code>
          </dt>
          <dd>{ENV.CLIENT_PUBLIC_STATIC}</dd>
          <dt>
            <code>CLIENT_PUBLIC_DYNAMIC</code>
          </dt>
          <dd>{ENV.CLIENT_PUBLIC_DYNAMIC}</dd>
        </dl>
        <p>
          Change the static value in <code>.env</code> and rebuild for production. Change the
          dynamic value in <code>.env.development</code> and reload this page. For production,
          change <code>.env.production</code>, restart the server, and reload. During development,
          Vite watches static configuration changes.
        </p>
      </section>
      <section>
        <h2>Server environment</h2>
        <p>
          These values live in <code>env/server/</code>. The server reads both static and dynamic
          values at startup; static values are also validated during builds. Fetching again reads
          the same startup snapshot. Restart the server after changing a value.
        </p>
        <p>
          This teaching endpoint deliberately returns dummy <code>SERVER_SECRET_*</code> values to
          demonstrate Varlock classification. Never put real credentials in these demo variables or
          return real secrets from an endpoint. They are not included in the browser configuration.
        </p>
        <button
          type="button"
          disabled={serverEnv.isFetching}
          onClick={() => {
            void serverEnv.refetch();
          }}
        >
          {serverEnv.isFetching ? "Fetching server envs…" : "Fetch server envs"}
        </button>
        {serverEnv.isError && <p role="alert">Server envs could not be loaded. Try again.</p>}
        {serverEnv.data && (
          <dl className="env-values" aria-live="polite">
            {Object.entries(serverEnv.data).map(([key, value]) => (
              <div key={key}>
                <dt>
                  <code>{key}</code>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}
