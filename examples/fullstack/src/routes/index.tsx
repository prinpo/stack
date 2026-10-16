import { createFileRoute } from "@prinpo/stack/react";
import { type FormEvent, useState } from "react";

import { api } from "../client";

export const Route = createFileRoute("/")({
  loader: async () => {
    const { data, error } = await api.api.hello.get({ query: { name: "Stack" } });
    if (error) throw new Error("The API greeting could not be loaded.");
    return data;
  },
  component: Home,
});

function Home() {
  const greeting = Route.useLoaderData();
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = new FormData(event.currentTarget).get("message");
    if (typeof message !== "string") return;
    setPending(true);
    try {
      const { data, error } = await api.api.echo.post({ message });
      setResult(error ? "The API rejected the message." : data.message);
    } catch {
      setResult("The API could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <p className="eyebrow">TYPED API READ</p>
      <h2>{greeting.message}</h2>
      <p>This greeting came from Elysia through Eden and the development proxy.</p>
      <form onSubmit={submit}>
        <label htmlFor="message">Send a typed API request</label>
        <div className="input-row">
          <input id="message" name="message" defaultValue="Connected through Stack" required />
          <button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send message"}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {result}
      </p>
    </section>
  );
}
