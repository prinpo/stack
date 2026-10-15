export function apiPrefix(value = "/api") {
  const prefix = value.replace(/\/+$/, "");
  if (!prefix.startsWith("/") || /[?#\s]/.test(prefix)) {
    throw new Error(
      "The API prefix must start with /, contain no query or fragment, and reserve a non-root path.",
    );
  }
  return prefix;
}
