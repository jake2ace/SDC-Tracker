import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiOperations, DemoUser, Workspace } from "./contract";
import { ENDPOINTS } from "./contract";
import { canonical } from "./client/canonical";
import { HttpClient } from "./client/http";
import { MockClient } from "./client/mock";
import { ClientError, type DataClient, type DataSource, type OperationId, type RequestParams } from "./client/types";
import { navigate } from "./route";
import { useT } from "../i18n";

export interface Toast { id: number; tone: "success" | "info" | "error"; text: string }
type RefreshOutcome = "ready" | "failed" | "superseded";

interface SessionValue {
  client: DataClient;
  mock: MockClient | null;
  source: DataSource;
  users: DemoUser[];
  usersError: ClientError | null;
  actor: DemoUser | null;
  workspace: Workspace | null;
  status: "loading" | "ready" | "error";
  error: ClientError | null;
  asOf: string | null;
  revision: number;
  isCurrentSession(actorId: string, revision: number): boolean;
  /** Increments after every successful write so dependent views (forecast) refetch. */
  dataVersion: number;
  switchActor(id: string): void;
  refresh(): Promise<RefreshOutcome>;
  toasts: Toast[];
  pushToast(tone: Toast["tone"], text: string): void;
  dismissToast(id: number): void;
}

const SessionContext = createContext<SessionValue | null>(null);

function pickSource(): DataSource {
  const fromUrl = new URLSearchParams(window.location.search).get("source");
  if (fromUrl === "api" || fromUrl === "mock") return fromUrl;
  // Fixtures are opt-in; normal development and production builds use the API.
  return import.meta.env.MODE === "mock" || import.meta.env.VITE_DATA_SOURCE === "mock" ? "mock" : "api";
}

const ACTOR_KEY = "p2c.actor";
function savedActor(): string | null {
  try { return window.localStorage.getItem(ACTOR_KEY); } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [source] = useState(pickSource);
  const [mock] = useState(() => (source === "mock" ? new MockClient() : null));
  const client: DataClient = useMemo(() => mock ?? new HttpClient(), [mock]);

  const [users, setUsers] = useState<DemoUser[]>([]);
  const [usersError, setUsersError] = useState<ClientError | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [error, setError] = useState<ClientError | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const actorRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const isCurrentSession = useCallback((id: string, version: number) =>
    actorRef.current === id && revisionRef.current === version, []);

  const pushToast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 9000 : 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const loadWorkspace = useCallback(async (forActor: string): Promise<RefreshOutcome> => {
    const mySeq = ++seq.current;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    try {
      const res = await client.request("getWorkspace", { actorId: forActor });
      // Drop late responses: another load or an identity switch happened meanwhile.
      if (mySeq !== seq.current || actorRef.current !== forActor) return "superseded";
      if (res.data.actor.id !== forActor || res.data.actor.companyId !== res.data.company.id) throw new ClientError({ kind: "bad_response", message: "Workspace company does not match the demo user." });
      setWorkspace(res.data);
      setAsOf(res.meta.asOf);
      setError(null);
      setStatus("ready");
      setDataVersion((v) => v + 1);
      return "ready";
    } catch (e) {
      if (mySeq !== seq.current) return "superseded";
      setWorkspace(null);
      setAsOf(null);
      setError(e instanceof ClientError ? e : new ClientError({ kind: "bad_response", message: String(e) }));
      setStatus("error");
      return "failed";
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    client.request("listDemoUsers").then((res) => {
      if (cancelled) return;
      setUsers(res.data.users);
      const saved = savedActor();
      const first = res.data.users.find((u) => u.id === saved) ?? res.data.users.find((u) => u.role === "finance") ?? res.data.users[0];
      if (!first) throw new ClientError({ kind: "bad_response", message: "No demo users are available." });
      actorRef.current = first.id; setActorId(first.id); void loadWorkspace(first.id);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setUsersError(e instanceof ClientError ? e : new ClientError({ kind: "network", message: String(e) }));
      setStatus("error");
    });
    return () => { cancelled = true; };
  }, [client, loadWorkspace]);

  useEffect(() => mock?.subscribe(() => {
    if (actorRef.current) void loadWorkspace(actorRef.current);
  }), [mock, loadWorkspace]);

  const switchActor = useCallback((id: string) => {
    const next = users.find((u) => u.id === id);
    if (!next || actorRef.current === id) return;
    const prev = users.find((u) => u.id === actorRef.current);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    actorRef.current = id;
    setActorId(id);
    setWorkspace(null);
    setAsOf(null);
    setStatus("loading");
    setError(null);
    setToasts([]);
    try { window.localStorage.setItem(ACTOR_KEY, id); } catch { /* storage is optional */ }
    if (!prev || prev.companyId !== next.companyId) {
      navigate("home");
    }
    void loadWorkspace(id);
  }, [users, loadWorkspace]);

  const refresh = useCallback(async (): Promise<RefreshOutcome> => {
    return actorRef.current ? loadWorkspace(actorRef.current) : "superseded";
  }, [loadWorkspace]);

  const actor = users.find((u) => u.id === actorId) ?? null;
  const value: SessionValue = {
    client, mock, source, users, usersError, actor, workspace, status, error, asOf, revision, isCurrentSession, dataVersion,
    switchActor, refresh, toasts, pushToast, dismissToast,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}

function newKey(op: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `ui:${op}:${rand}`;
}

export type ActionParams = Omit<RequestParams, "actorId" | "idempotencyKey">;

/**
 * One write action. Guards double submits, keeps the same Idempotency-Key when the same
 * request is retried after a failure, and refreshes the workspace only after the server
 * (or fixture) confirms success.
 */
export function useAction<K extends OperationId>(op: K) {
  const { client, actor, refresh, pushToast, mock, revision, isCurrentSession, status } = useSession();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ClientError | null>(null);
  const [replayed, setReplayed] = useState(false);
  const inflight = useRef(false);
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const roles = ENDPOINTS[op].roles as readonly string[];
  const roleAllowed = actor ? roles.includes(actor.role) : false;
  const supported = client.supports(op);

  const run = useCallback(async (params: ActionParams, successText?: string): Promise<ApiOperations[K]["response"] | null> => {
    if (inflight.current || !actor || !roleAllowed || !supported || status !== "ready" || !isCurrentSession(actor.id, revision)) return null;
    const current = () => mounted.current && isCurrentSession(actor.id, revision);
    const fingerprint = canonical({
      op, actorId: actor.id, revision, id: params.id ?? null, body: params.body ?? null,
      fields: params.multipart?.fields ?? null,
      file: params.multipart ? [params.multipart.file.name, params.multipart.file.size, params.multipart.file.lastModified] : null,
    });
    if (!keyRef.current || keyRef.current.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newKey(op) };
    inflight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await client.request(op, { ...params, actorId: actor.id, idempotencyKey: keyRef.current.key });
      if (!current()) return null;
      keyRef.current = null;
      const wasReplay = "meta" in res && res.meta.idempotencyReplayed;
      setReplayed(Boolean(wasReplay));
      const refreshed = await refresh();
      if (!isCurrentSession(actor.id, revision)) return null;
      if (refreshed === "failed") {
        pushToast("info", t("Saved, but the workspace could not be refreshed. Retry loading to see the current balances; do not submit the operation again."));
        return null;
      }
      if (refreshed === "superseded") return null;
      if (successText) pushToast("success", wasReplay ? `${successText} ${t("(already done earlier, no change made)")}` : successText);
      if (mock?.lastNote) pushToast("info", t("Mock returned the approved fixture result. Your edited free text is not stored in mock mode."));
      return mounted.current ? res : null;
    } catch (e) {
      if (!current()) return null;
      const err = e instanceof ClientError ? e : new ClientError({ kind: "bad_response", message: String(e) });
      if (!err.retryable) keyRef.current = null;
      setError(err);
      if (err.code === "VERSION_CONFLICT" || err.code === "CREDIT_ALREADY_ALLOCATED" || err.code === "INVALID_STATE") await refresh();
      return null;
    } finally {
      inflight.current = false;
      if (current()) setPending(false);
    }
  }, [actor, client, op, refresh, pushToast, mock, revision, isCurrentSession, status, roleAllowed, supported, t]);

  const clearError = useCallback(() => setError(null), []);
  return { run, pending, error, clearError, replayed, roleAllowed, supported, roles };
}
