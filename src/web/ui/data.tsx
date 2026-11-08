import { useEffect, useState } from "react";

// Several components ask for the same project data at once (list thumbnail,
// card strip, gallery; stage bar and timeline). Identical URLs share one
// request for `maxAge` ms.
const cache = new Map<string, { at: number; request: Promise<any> }>();
export function getJson(url: string, maxAge = 1500): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAge) return hit.request;
  const request = fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });
  cache.set(url, { at: Date.now(), request });
  request.catch(() => cache.delete(url));
  for (const [key, value] of cache)
    if (Date.now() - value.at > 60000) cache.delete(key);
  return request;
}

// Fetches `url` whenever it or `version` changes, and every `interval` ms
// while the page is visible. Hidden tabs never poll.
export function useJson<T>(
  url: string | null,
  options: { interval?: number; version?: unknown; maxAge?: number } = {},
) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  const { interval, version, maxAge } = options;
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () => {
      if (document.hidden) return;
      getJson(url, maxAge).then(
        (data) => alive && setState({ data, error: null }),
        (e: Error) =>
          alive && setState((s) => ({ data: s.data, error: e.message })),
      );
    };
    const schedule = () => {
      clearInterval(timer);
      if (interval && !document.hidden) timer = setInterval(load, interval);
    };
    const visibility = () => {
      if (!document.hidden) load();
      schedule();
    };
    load();
    schedule();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [url, interval, version, maxAge]);
  return state;
}

// Re-renders every `ms` so relative times ("12초 전") stay current.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const projectApi = (id: string, path: string) =>
  `/api/projects/${encodeURIComponent(id)}/${path}`;

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });

export const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

// "14:03" today, "10월 8일 14:03" on other days.
export function when(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? hm(iso)
    : `${d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} ${hm(iso)}`;
}

export function minutes(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}분`;
  if (m < 2880) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
}

export function ago(iso: string | null | undefined, now: number) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}초 전` : `${minutes(now - t)} 전`;
}

export const statusNames: Record<string, string> = {
  queued: "큐 대기",
  starting: "시작 중",
  running: "실행 중",
  waiting_input: "입력 필요",
  retrying: "재시도 중",
  paused: "일시정지",
  cancelling: "취소 중",
  review_pending: "검토 대기",
  failed: "실패",
  cancelled: "취소됨",
  superseded: "대체됨",
};
export const taskNames: Record<string, string> = {
  pending: "대기",
  running: "진행 중",
  waiting_input: "입력 대기",
  retrying: "재시도",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

export interface Shot {
  name: string;
  path: string;
  viewport: "desktop" | "mobile";
  full: boolean;
  size?: number;
  mtime: string;
}
export interface Round {
  round: string;
  stage: string;
  at: string;
  verdict: string | null;
  files: Shot[];
}
export interface Asset {
  name: string;
  path: string;
  size?: number;
  mtime: string;
}
export interface Shots {
  run_id: string;
  rounds: Round[];
  assets: Asset[];
}
export const shotUrl = (id: string, s: { path: string; mtime: string }) =>
  projectApi(id, `shots/${s.path}?v=${encodeURIComponent(s.mtime)}`);
export const assetUrl = (id: string, a: { path: string; mtime: string }) =>
  projectApi(id, `assets/${a.path}?v=${encodeURIComponent(a.mtime)}`);
export const roundName = (r: string) => (r === "final" ? "최종" : `${r}회차`);

// Shots change when look.py finishes a round, which is usually followed by a
// progress report (a new revision); the interval catches rounds without one.
// Idle projects pass interval 0 and refresh on a new revision only.
export function useShots(id: string, revision: unknown, interval = 20000) {
  return useJson<Shots>(projectApi(id, "shots"), {
    version: revision,
    interval,
    maxAge: 3000,
  });
}

export function bytes(n: number | undefined) {
  if (n === undefined) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function useEvents(id: string, revision: unknown) {
  return useJson<{ events: BrokerEvent[]; next_before: number | null }>(
    projectApi(id, "events?limit=200"),
    { version: revision, maxAge: 1500 },
  );
}
export interface BrokerEvent {
  seq: number;
  at: string;
  run_id: string;
  kind: string;
  [field: string]: any;
}
