import { useState } from "react";

import { authClient } from "../../client/auth";

export function ResetPasswordView() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const token = new URLSearchParams(window.location.search).get("token");
  return (
    <section>
      <h2>Reset password</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await authClient.resetPassword({
            newPassword: password,
            token: token ?? undefined,
          });
          setMessage(result.error?.message ?? "Password updated. You can sign in.");
        }}
      >
        <label>
          New password
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button disabled={!token}>Update password</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
