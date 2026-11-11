import { useMutation, useQuery } from "@prinpo/stack/query";
import { createFileRoute } from "@prinpo/stack/react";
import { useState } from "react";

import { eden } from "../client";
import { ENV } from "../env-gen/client";

export const Route = createFileRoute("/")({ component: EnvironmentSandbox });

function EnvironmentSandbox() {
  const serverEnv = useQuery({ ...eden.env.get.queryOptions(), enabled: false });
  const notes = useQuery(eden.notes.get.queryOptions());
  const notebooks = useQuery(eden.notebooks.get.queryOptions());
  const [notebookName, setNotebookName] = useState("");
  const [notebookId, setNotebookId] = useState("");
  const [text, setText] = useState("");
  const addNote = useMutation(
    eden.notes.post.mutationOptions({
      onSuccess: async () => {
        setText("");
        await Promise.all([notes.refetch(), notebooks.refetch()]);
      },
    }),
  );

  const addNotebook = useMutation(
    eden.notebooks.post.mutationOptions({
      onSuccess: async (created) => {
        setNotebookName("");
        if (created[0]) setNotebookId(String(created[0].id));
        await notebooks.refetch();
      },
    }),
  );

  return (
    <>
      <section>
        <h2>Notebooks and notes</h2>
        <p>
          Create notebooks, add notes, and explore their relationships. Everything remains available
          after the server restarts.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addNotebook.mutate({ name: notebookName });
          }}
        >
          <label>
            Notebook{" "}
            <input
              value={notebookName}
              maxLength={100}
              onChange={(event) => setNotebookName(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={addNotebook.isPending}>
            {addNotebook.isPending ? "Creating…" : "Create notebook"}
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addNote.mutate({ text, ...(notebookId ? { notebookId: Number(notebookId) } : {}) });
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
          <label>
            Notebook{" "}
            <select value={notebookId} onChange={(event) => setNotebookId(event.target.value)}>
              <option value="">Unfiled</option>
              {notebooks.data?.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={addNote.isPending}>
            {addNote.isPending ? "Saving…" : "Save note"}
          </button>
        </form>
        {(notes.isError || notebooks.isError || addNote.isError || addNotebook.isError) && (
          <p role="alert">Could not load or save notebooks and notes. Please try again.</p>
        )}
        <ul>
          {notes.data?.map((note) => (
            <li key={note.id}>
              {note.text} <small>— {note.notebook?.name ?? "Unfiled"}</small>
            </li>
          ))}
        </ul>
        <h3>Notes by notebook</h3>
        {notebooks.data?.map((notebook) => (
          <article key={notebook.id}>
            <h4>
              {notebook.name} ({notebook.notes.length})
            </h4>
            <ul>
              {notebook.notes.map((note) => (
                <li key={note.id}>{note.text}</li>
              ))}
            </ul>
          </article>
        ))}
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
