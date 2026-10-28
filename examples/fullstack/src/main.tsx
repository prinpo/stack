import { loadPublicDynamicEnv } from "@prinpo/stack/env";

async function start() {
  try {
    await loadPublicDynamicEnv({ endpoint: "/api/public-env" });
    await import("./application");
  } catch {
    const root = document.getElementById("root");
    if (!root) return;
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = "The application could not start. Please try again.";
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.addEventListener(
      "click",
      () => {
        retry.disabled = true;
        void start();
      },
      { once: true },
    );
    root.replaceChildren(message, retry);
  }
}

void start();
