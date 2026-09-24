/**
 * NIP-07-compatible signer facade for the Nosu host application.
 *
 * Armada continues to own its login records, database, relay routing and all
 * protocol code. Only signer operations cross this boundary, over an
 * origin-checked postMessage channel. No secret key is requested or exposed.
 */

const PROTOCOL = "nosu-groups-v1";

type HostSession = {
  status: "anonymous" | "readonly" | "signed";
  pubkey?: string;
  signerKind?: "privatekey" | "nip07" | "nip46";
};

export type HostTheme = {
  name: string;
  mode: "light" | "dark";
  colors: {
    background: string;
    text: string;
    primary: string;
  };
};

type ResponseMessage = {
  protocol: typeof PROTOCOL;
  type: "response";
  id: string;
  result?: unknown;
  error?: string;
};

let currentSession: HostSession = { status: "anonymous" };
let currentTheme: HostTheme | undefined;
const listeners = new Set<(session: HostSession) => void>();
const themeListeners = new Set<() => void>();
const navigationListeners = new Set<(path: string) => void>();
let requestedPath: string | undefined;
type QueuedCall = {
  id: string;
  method: string;
  params: unknown[];
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type PendingCall = Pick<QueuedCall, "method" | "resolve" | "reject"> & {
  timeout: number;
  startedAt: number;
};

const queued: QueuedCall[] = [];
let activeCalls = 0;
const pending = new Map<
  string,
  PendingCall
>();

function bridgeLog(event: string, detail: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[nosu groups child] ${event} ${JSON.stringify(detail)}`);
}

function configuredParentOrigin(): string | undefined {
  const configured = import.meta.env.VITE_NOSU_PARENT_ORIGIN as string | undefined;
  if (configured) return new URL(configured).origin;
  if (!document.referrer) return undefined;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return undefined;
  }
}

const embedded = window.parent !== window;
const parentOrigin = embedded ? configuredParentOrigin() : undefined;

function requestPriority(method: string): number {
  if (method === "signEvent") return 0;
  if (method.endsWith(".decrypt")) return 2;
  return 1;
}

function concurrencyLimit(): number {
  return currentSession.signerKind === "privatekey" ? 8 : 1;
}

function finishCall(id: string): PendingCall | undefined {
  const call = pending.get(id);
  if (!call) return undefined;
  pending.delete(id);
  window.clearTimeout(call.timeout);
  activeCalls = Math.max(0, activeCalls - 1);
  pumpQueue();
  return call;
}

function dispatch(call: QueuedCall): void {
  if (!parentOrigin) return;
  activeCalls += 1;
  const startedAt = performance.now();
  const timeout = window.setTimeout(() => {
    const timedOut = finishCall(call.id);
    if (!timedOut) return;
    bridgeLog("request:timeout", {
      id: call.id.slice(0, 8),
      method: call.method,
      elapsedMs: Math.round(performance.now() - timedOut.startedAt),
    });
    timedOut.reject(new Error("The Nosu signer request timed out."));
  }, 120_000);
  pending.set(call.id, {
    method: call.method,
    resolve: call.resolve,
    reject: call.reject,
    timeout,
    startedAt,
  });
  bridgeLog("request:dispatch", {
    id: call.id.slice(0, 8),
    method: call.method,
    active: activeCalls,
    queued: queued.length,
    signerKind: currentSession.signerKind,
  });
  window.parent.postMessage(
    { protocol: PROTOCOL, type: "request", id: call.id, method: call.method, params: call.params },
    parentOrigin,
  );
}

function pumpQueue(): void {
  while (activeCalls < concurrencyLimit() && queued.length > 0) {
    let nextIndex = 0;
    for (let index = 1; index < queued.length; index += 1) {
      if (requestPriority(queued[index].method) < requestPriority(queued[nextIndex].method)) {
        nextIndex = index;
      }
    }
    const [next] = queued.splice(nextIndex, 1);
    dispatch(next);
  }
}

function request(method: string, params: unknown[] = []): Promise<unknown> {
  if (!embedded || !parentOrigin) {
    return Promise.reject(new Error("The Nosu host signer is unavailable."));
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    queued.push({ id, method, params, resolve, reject });
    bridgeLog("request:queue", {
      id: id.slice(0, 8),
      method,
      active: activeCalls,
      queued: queued.length,
    });
    pumpQueue();
  });
}

function notifySession(session: HostSession): void {
  currentSession = session;
  bridgeLog("session:receive", {
    status: session.status,
    signerKind: session.signerKind,
  });
  for (const listener of listeners) listener(session);
  pumpQueue();
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && value.length <= 4096;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function readHostTheme(value: unknown): HostTheme | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<HostTheme>;
  const colors = candidate.colors;
  if (
    typeof candidate.name !== "string" || candidate.name.length > 64 ||
    (candidate.mode !== "light" && candidate.mode !== "dark") ||
    !colors ||
    !isHexColor(colors.background) ||
    !isHexColor(colors.text) ||
    !isHexColor(colors.primary)
  ) return undefined;
  return {
    name: candidate.name,
    mode: candidate.mode,
    colors: {
      background: colors.background,
      text: colors.text,
      primary: colors.primary,
    },
  };
}

if (embedded && parentOrigin) {
  let helloTimer: number | undefined;
  let helloAttempts = 0;
  const sendHello = (): void => {
    helloAttempts += 1;
    bridgeLog("hello:send", { attempt: helloAttempts });
    window.parent.postMessage({ protocol: PROTOCOL, type: "hello" }, parentOrigin);
    if (helloAttempts >= 15 && helloTimer !== undefined) {
      window.clearInterval(helloTimer);
      helloTimer = undefined;
    }
  };

  const onHostMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const message = event.data as { protocol?: unknown; type?: unknown };
    if (message?.protocol !== PROTOCOL) return;

    if (message.type === "session") {
      const session = message as HostSession & { type: "session" };
      bridgeLog("session:raw", {
        fields: Object.keys(message).sort(),
        signerKind: session.signerKind,
      });
      const signerKind = session.signerKind ?? (
        session.status === "signed" ? currentSession.signerKind : undefined
      );
      // A host from before signer-kind negotiation may still be alive during
      // Vite/Next HMR. Keep asking until the current host answers completely.
      if (helloTimer !== undefined && (session.status !== "signed" || signerKind !== undefined)) {
        window.clearInterval(helloTimer);
        helloTimer = undefined;
      }
      notifySession({
        status: session.status,
        ...(session.pubkey ? { pubkey: session.pubkey } : {}),
        ...(signerKind ? { signerKind } : {}),
      });
      return;
    }

    if (message.type === "theme") {
      const theme = readHostTheme(message);
      if (!theme) return;
      currentTheme = theme;
      bridgeLog("theme:receive", { name: theme.name, mode: theme.mode });
      for (const listener of themeListeners) listener();
      return;
    }

    if (message.type === "navigate") {
      const path = (message as { path?: unknown }).path;
      if (!safePath(path)) return;
      requestedPath = path;
      for (const listener of navigationListeners) listener(path);
      return;
    }

    if (message.type !== "response") return;
    const response = message as ResponseMessage;
    const call = finishCall(response.id);
    if (!call) {
      bridgeLog("response:orphan", { id: response.id.slice(0, 8) });
      return;
    }
    bridgeLog(response.error ? "request:error" : "request:complete", {
      id: response.id.slice(0, 8),
      method: call.method,
      elapsedMs: Math.round(performance.now() - call.startedAt),
      ...(response.error ? { error: response.error } : {}),
    });
    if (response.error) call.reject(new Error(response.error));
    else call.resolve(response.result);
  };

  window.addEventListener("message", onHostMessage);

  const provider = {
    getPublicKey: () => request("getPublicKey") as Promise<string>,
    signEvent: (event: unknown) => request("signEvent", [event]),
    getRelays: async () => ({}),
    nip44: {
      encrypt: (pubkey: string, plaintext: string) =>
        request("nip44.encrypt", [pubkey, plaintext]) as Promise<string>,
      decrypt: (pubkey: string, ciphertext: string) =>
        request("nip44.decrypt", [pubkey, ciphertext]) as Promise<string>,
    },
  };

  try {
    Object.defineProperty(window, "nostr", {
      value: provider,
      configurable: true,
      enumerable: true,
    });
  } catch (error) {
    console.error("[nosu] Could not install the embedded signer facade", error);
  }

  sendHello();
  helloTimer = window.setInterval(sendHello, 1_000);

  import.meta.hot?.dispose(() => {
    window.removeEventListener("message", onHostMessage);
    if (helloTimer !== undefined) window.clearInterval(helloTimer);
  });
}

export function isNosuHosted(): boolean {
  return embedded && parentOrigin !== undefined;
}

export function getHostSession(): HostSession {
  return currentSession;
}

export function subscribeHostSession(listener: (session: HostSession) => void): () => void {
  listeners.add(listener);
  listener(currentSession);
  return () => {
    listeners.delete(listener);
  };
}

export function getHostTheme(): HostTheme | undefined {
  return currentTheme;
}

export function subscribeHostTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function publishHostNavigation(path: string): void {
  if (!embedded || !parentOrigin || !safePath(path)) return;
  window.parent.postMessage({ protocol: PROTOCOL, type: "navigation", path }, parentOrigin);
}

export function subscribeHostNavigation(listener: (path: string) => void): () => void {
  navigationListeners.add(listener);
  if (requestedPath) listener(requestedPath);
  return () => {
    navigationListeners.delete(listener);
  };
}
