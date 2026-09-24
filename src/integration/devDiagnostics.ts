/** Development-only boot diagnostics, mirrored to the Vite terminal. */

type DiagnosticDetail = Record<string, string | number | boolean | null | undefined>;

const startedAt = performance.now();

function parentOrigin(): string | undefined {
  if (window.parent === window || !document.referrer) return undefined;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return undefined;
  }
}

function errorDetail(error: unknown): DiagnosticDetail {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.slice(0, 2_000),
    };
  }
  return { errorMessage: String(error).slice(0, 2_000) };
}

export function devDiagnostic(event: string, detail: DiagnosticDetail = {}): void {
  if (!import.meta.env.DEV) return;
  const payload = {
    event,
    atMs: Math.round(performance.now() - startedAt),
    readyState: document.readyState,
    visibility: document.visibilityState,
    path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ...detail,
  };

  console.info(`[nostrix groups init] ${event}`, payload);

  // The parent also records the event in its browser console. This contains
  // lifecycle metadata only: never keys, event bodies, or decrypted content.
  const origin = parentOrigin();
  if (origin) {
    window.parent.postMessage(
      { protocol: "nostrix-groups-v1", type: "diagnostic", payload },
      origin,
    );
  }

  // In development, mirror the same small payload to Vite so the exact boot
  // sequence remains visible in the terminal after a blank iframe load.
  void fetch("/__nostrix-diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

devDiagnostic("module:evaluate", {
  embedded: window.parent !== window,
  hasReferrer: document.referrer.length > 0,
});

window.addEventListener("DOMContentLoaded", () => devDiagnostic("document:dom-content-loaded"), { once: true });
window.addEventListener("load", () => devDiagnostic("window:load"), { once: true });
window.addEventListener("pageshow", (event) => devDiagnostic("window:pageshow", { persisted: event.persisted }));
window.addEventListener("pagehide", (event) => devDiagnostic("window:pagehide", { persisted: event.persisted }));
document.addEventListener("visibilitychange", () => devDiagnostic("document:visibility-change"));
window.addEventListener("error", (event) => {
  devDiagnostic("window:error", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    ...errorDetail(event.error),
  });
});
window.addEventListener("unhandledrejection", (event) => {
  devDiagnostic("window:unhandled-rejection", errorDetail(event.reason));
});
