/** Example delivery adapter for the Mailpit service in the production Compose file. */
export function mailpitSender(mailUrl: string) {
  const endpoint = new URL("/api/v1/send", mailUrl);
  return async (to: string, subject: string, text: string) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: "stack@example.test" },
        To: [{ Email: to }],
        Subject: subject,
        Text: text,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Example mail delivery failed (${response.status})`);
  };
}
