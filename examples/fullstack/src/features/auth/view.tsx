import { useState } from "react";

import { authClient } from "../../auth-client";

export function AuthView() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const last = authClient.getLastUsedLoginMethod();
  async function action(work: () => Promise<{ error?: { message?: string } | null }>) {
    try {
      const result = await work();
      setMessage(
        result.error?.message ??
          "Done. Check the browser or server console for development email delivery.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  if (isPending) return <p>Loading session…</p>;
  if (session)
    return (
      <section>
        <h2>Session</h2>
        <p>Signed in as {session.user.email}</p>
        <p>
          <a href="/organizations">Organizations</a>
        </p>
        <button onClick={() => void action(() => authClient.signOut())}>Sign out</button>
        <p role="status">{message}</p>
      </section>
    );
  return (
    <section>
      <h2>Authentication</h2>
      <p>Native Better Auth methods. Email links and codes appear in development consoles.</p>
      {last && <p>Last used: {last}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action(() => authClient.signIn.email({ email, password }));
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit">Sign in</button>{" "}
        <button
          type="button"
          onClick={() => void action(() => authClient.signUp.email({ email, name, password }))}
        >
          Create account
        </button>
        <p>
          <button
            type="button"
            onClick={() =>
              void action(() => authClient.signIn.magicLink({ email, callbackURL: "/auth" }))
            }
          >
            Send magic link
          </button>{" "}
          <button
            type="button"
            onClick={() =>
              void action(() => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }))
            }
          >
            Send login code
          </button>
        </p>
        <label>
          Login code
          <input
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            autoComplete="one-time-code"
          />
        </label>
        <button
          type="button"
          onClick={() => void action(() => authClient.signIn.emailOtp({ email, otp }))}
        >
          Use login code
        </button>
        <p>
          <button
            type="button"
            onClick={() =>
              void action(() => authClient.sendVerificationEmail({ email, callbackURL: "/auth" }))
            }
          >
            Verify email
          </button>{" "}
          <button
            type="button"
            onClick={() =>
              void action(() =>
                authClient.requestPasswordReset({
                  email,
                  redirectTo: new URL("/auth/reset", window.location.origin).href,
                }),
              )
            }
          >
            Reset password
          </button>
        </p>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
