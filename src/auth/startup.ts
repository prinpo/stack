/** A native decorator carries the explicitly installed integration to Stack's pre-listen gate. */
export const authStartup = "__prinpoAuthStartup";
export async function validateApplicationAuth(app: { decorator: Record<string, unknown> }) {
  const validate = app.decorator[authStartup];
  if (typeof validate === "function") await validate();
}
