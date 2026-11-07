import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, FileText, RefreshCw, RotateCcw } from "lucide-react";

type Draft = {
  project_id: string;
  name: string;
  business: string;
  audience: string;
  primary_action: string;
  must_include: string[];
  tone: string;
  sections: string[];
  images: string;
  missing: string[];
};
type Documents = {
  project_id: string;
  prd: string;
  design: string;
  at: string;
  user_turns: number;
};
type View = {
  concept_id: string;
  messages: {
    role: "agent" | "user";
    text: string;
    choices?: string[];
  }[];
  draft: Draft | null;
  ready: boolean;
  user_turns: number;
  max_user_turns: number;
  documents: Documents | null;
  documents_stale: boolean;
  pending:
    | {
        kind: "message";
        client_message_id: string;
        text: string;
        started_at: string;
      }
    | { kind: "documents"; client_request_id: string; started_at: string }
    | null;
  agent: { available: boolean; reason: string | null; message?: string };
};
type Failure = { text: string; id: string; code: string; message: string };
type ComposeFailure = { id: string; code: string; message: string };

const KEY = "homepage-concept-v1";
const MAX_TEXT = 2000;
// The landing's first-line box (Landing.tsx) leaves its text here once; it
// only fills the input and is never sent on its own.
const SEED = "homepage-concept-seed";
// The model may take up to 120 s (a turn) or 240 s (documents); the server
// keeps the result even if this request gives up, and a resend with the same
// id returns it.
const TURN_TIMEOUT = 150_000;
const COMPOSE_TIMEOUT = 270_000;
// Codes that a resend will not fix: point to 문서 직접 작성 instead.
const unavailable = ["concept_claude_missing", "concept_login_required"];

const fields: [keyof Draft, string][] = [
  ["name", "이름"],
  ["business", "하는 일"],
  ["audience", "방문자"],
  ["primary_action", "방문자가 할 행동"],
  ["must_include", "꼭 넣을 정보"],
  ["tone", "분위기"],
  ["sections", "구역 구성"],
  ["images", "사진 방향"],
];

function storage(id?: string | null) {
  try {
    if (id === undefined) return sessionStorage.getItem(KEY);
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {}
  return null;
}

function takeSeed() {
  try {
    const text = sessionStorage.getItem(SEED) ?? "";
    sessionStorage.removeItem(SEED);
    return text.slice(0, MAX_TEXT);
  } catch {
    return "";
  }
}

// Ticks once a second only while a reply is being made.
function useTick(on: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
}

// 대화로 만들기: a tool-less agent asks a few easy questions and fills the
// concept card. Once `ready`, 문서 만들기 writes project_id/prd/design in a
// separate call and hands them to the 문서 직접 작성 tab (onUseDraft).
// Sending still goes through the existing init/submit buttons.
export function Concept(props: {
  csrf: string | null;
  active: boolean;
  onUseDraft: (draft: {
    project_id: string;
    prd: string;
    design: string;
  }) => void;
  onManual: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState<{
    text: string;
    started: number;
  } | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [composing, setComposing] = useState<{
    id: string;
    started: number;
  } | null>(null);
  const [composeFailed, setComposeFailed] = useState<ComposeFailure | null>(
    null,
  );
  const [input, setInput] = useState(takeSeed);
  const [cardOpen, setCardOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function call(url: string, body?: object, timeout = 10000) {
    let res: Response;
    try {
      res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
        ...(body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Homepage-Token": props.csrf ?? "",
              },
              body: JSON.stringify(body),
            }
          : {}),
      });
    } catch (e: any) {
      throw Object.assign(
        new Error(
          e?.name === "TimeoutError"
            ? "응답이 늦어지고 있습니다. 다시 보내면 이어서 확인합니다."
            : "브로커와 연결하지 못했습니다. 다시 보내 보세요.",
        ),
        { code: "network" },
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), {
        code: data.error ?? "network",
      });
    return data;
  }

  async function start(fresh = false) {
    setLoading(true);
    setLoadError(null);
    setFailed(null);
    setComposeFailed(null);
    try {
      const saved = fresh ? null : storage();
      if (saved)
        try {
          setView(await call(`/api/concepts/${encodeURIComponent(saved)}`));
          return;
        } catch (e: any) {
          if (e.code !== "unknown_concept") throw e;
        }
      const v: View = await call("/api/concepts", {});
      storage(v.concept_id);
      setView(v);
      // Only 초기화 clears the box; a first open keeps the landing's line.
      if (fresh) setInput("");
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (props.active && props.csrf && !view && !loading && !loadError)
      void start();
  }, [props.active, props.csrf]);

  // After a reload the server may still be making the reply or the
  // documents: follow it, and open finished documents as a click would.
  const pendingKey = view?.pending
    ? view.pending.kind === "message"
      ? view.pending.client_message_id
      : view.pending.client_request_id
    : null;
  useEffect(() => {
    if (!props.active || !view?.pending || sending || composing) return;
    const writing = view.pending.kind === "documents";
    const t = setInterval(() => {
      call(`/api/concepts/${encodeURIComponent(view.concept_id)}`).then(
        (next: View) => {
          setView(next);
          if (!writing || next.pending) return;
          if (next.documents && !next.documents_stale) openDocs(next.documents);
          else
            setComposeFailed({
              id: crypto.randomUUID(),
              code: "concept_failed",
              message: "문서를 만들지 못했습니다. 다시 시도하세요.",
            });
        },
        () => {},
      );
    }, 2000);
    return () => clearInterval(t);
  }, [props.active, view?.concept_id, pendingKey, sending, composing]);

  const writing = !!composing || view?.pending?.kind === "documents";
  const busy = !!sending || writing || !!view?.pending;
  useTick(busy);
  const count = view?.messages.length ?? 0;
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, busy, failed, composeFailed, cardOpen]);
  useEffect(() => {
    if (props.active && !busy) box.current?.focus({ preventScroll: true });
  }, [props.active, busy, view?.concept_id]);

  async function send(text: string, id: string = crypto.randomUUID()) {
    if (!view || busy || !text.trim()) return;
    setFailed(null);
    setSending({ text, started: Date.now() });
    try {
      setView(
        await call(
          `/api/concepts/${encodeURIComponent(view.concept_id)}/messages`,
          { text, client_message_id: id },
          TURN_TIMEOUT,
        ),
      );
    } catch (e: any) {
      setFailed({ text, id, code: e.code, message: e.message });
    } finally {
      setSending(null);
    }
  }

  function openDocs(d: Documents) {
    props.onUseDraft({
      project_id: d.project_id,
      prd: d.prd,
      design: d.design,
    });
  }

  async function compose(id: string = crypto.randomUUID()) {
    if (!view || busy) return;
    setFailed(null);
    setComposeFailed(null);
    setComposing({ id, started: Date.now() });
    try {
      const next: View = await call(
        `/api/concepts/${encodeURIComponent(view.concept_id)}/documents`,
        { client_request_id: id },
        COMPOSE_TIMEOUT,
      );
      setView(next);
      if (next.documents) openDocs(next.documents);
    } catch (e: any) {
      setComposeFailed({ id, code: e.code, message: e.message });
    } finally {
      setComposing(null);
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || text.length > MAX_TEXT) return;
    setInput("");
    void send(text);
  }

  function keydown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while a Korean IME is composing only commits the syllable.
    if (
      e.key !== "Enter" ||
      e.shiftKey ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    )
      return;
    e.preventDefault();
    submit();
  }

  if (!view)
    return (
      <div className="concept concept-loading">
        {loadError ? (
          <div className="note" data-tone="danger" role="alert">
            <div className="note-main">
              <span className="note-title">대화를 시작하지 못했습니다</span>
              <span className="note-body">{loadError}</span>
              <div className="button-row">
                <button className="btn btn-sm" onClick={() => void start()}>
                  다시 시도
                </button>
                <button className="btn btn-sm" onClick={props.onManual}>
                  문서 직접 작성
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="help">대화를 준비하고 있습니다…</p>
        )}
      </div>
    );

  const draft = view.draft;
  const last = view.messages.at(-1);
  const pendingText =
    sending?.text ??
    (view.pending?.kind === "message" ? view.pending.text : undefined);
  const started =
    composing?.started ??
    sending?.started ??
    (view.pending ? Date.parse(view.pending.started_at) : Date.now());
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  const limit = view.user_turns >= view.max_user_turns;
  const off = !view.agent.available;
  const canSend = !busy && !limit && !off;
  const docs = view.documents;
  const fresh = !!docs && !view.documents_stale;
  // open: latest documents, no model call. again: the chat went on after
  // them. make: first documents. off: not ready yet.
  const action = fresh ? "open" : !view.ready ? "off" : docs ? "again" : "make";
  const filled = fields.filter(([key]) => {
    const v = draft?.[key];
    return Array.isArray(v) ? v.length > 0 : !!v;
  }).length;
  const status = fresh ? "문서 준비됨" : `${filled}/${fields.length}`;

  return (
    <div className="concept">
      <aside className="concept-card" data-open={cardOpen}>
        <button
          className="concept-card-toggle"
          aria-expanded={cardOpen}
          onClick={() => setCardOpen((o) => !o)}
        >
          <span className="concept-card-title">컨셉 카드</span>
          <span className="badge" data-tone={fresh ? "ok" : undefined}>
            {status}
          </span>
          <span className="concept-card-name">{draft?.name}</span>
          <ChevronDown className="icon icon-sm" aria-hidden />
        </button>
        <div className="concept-card-head">
          <h3 className="concept-card-title">컨셉 카드</h3>
          <span className="badge" data-tone={fresh ? "ok" : undefined}>
            {status}
          </span>
        </div>
        <div className="concept-card-body">
          <dl className="concept-fields">
            {fields.map(([key, label]) => {
              const v = draft?.[key];
              const empty = Array.isArray(v) ? !v.length : !v;
              return (
                <div key={key} className="concept-field">
                  <dt>{label}</dt>
                  <dd>
                    {empty ? (
                      <span className="concept-empty">
                        아직 정하지 않았어요
                      </span>
                    ) : Array.isArray(v) ? (
                      <ul>
                        {v.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {!!draft?.missing.length && !view.ready && (
            <p className="concept-missing">
              아직 모르는 것: {draft.missing.join(", ")}
            </p>
          )}
        </div>
      </aside>
      <section className="concept-chat" aria-label="에이전트와 대화">
        <div
          className="concept-log"
          ref={log}
          role="log"
          aria-live="polite"
          aria-busy={busy}
        >
          {view.messages.map((m, i) => (
            <div key={i} className="concept-msg" data-role={m.role}>
              <p className="concept-bubble">{m.text}</p>
            </div>
          ))}
          {pendingText && (
            <div className="concept-msg" data-role="user">
              <p className="concept-bubble">{pendingText}</p>
            </div>
          )}
          {busy && (
            <div className="concept-msg" data-role="agent">
              <p className="concept-bubble concept-thinking" role="status">
                {writing
                  ? `문서를 쓰고 있어요 · ${seconds}초 · 보통 1분 안팎`
                  : `생각하는 중 · ${seconds}초`}
              </p>
            </div>
          )}
          {failed && !busy && (
            <>
              <div className="concept-msg" data-role="user" data-state="failed">
                <p className="concept-bubble">{failed.text}</p>
              </div>
              <div
                className="note concept-error"
                data-tone="danger"
                role="alert"
              >
                <div className="note-main">
                  <span className="note-body">{failed.message}</span>
                  <div className="button-row">
                    {!unavailable.includes(failed.code) && (
                      <button
                        className="btn btn-sm"
                        onClick={() => void send(failed.text, failed.id)}
                      >
                        다시 보내기
                      </button>
                    )}
                    {(unavailable.includes(failed.code) ||
                      failed.code === "concept_timeout") && (
                      <button className="btn btn-sm" onClick={props.onManual}>
                        문서 직접 작성
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {!busy &&
            !failed &&
            canSend &&
            last?.role === "agent" &&
            !!last.choices?.length && (
              <div className="concept-choices" aria-label="빠른 답">
                {last.choices.map((c, i) => (
                  <button
                    key={i}
                    className="concept-chip"
                    onClick={() => void send(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          {composeFailed && !busy && (
            <div
              className="note concept-error"
              data-kind="documents"
              data-tone="danger"
              role="alert"
            >
              <div className="note-main">
                <span className="note-body">{composeFailed.message}</span>
                <div className="button-row">
                  {!unavailable.includes(composeFailed.code) && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void compose(composeFailed.id)}
                    >
                      다시 시도
                    </button>
                  )}
                  {(unavailable.includes(composeFailed.code) ||
                    composeFailed.code === "concept_timeout") && (
                    <button className="btn btn-sm" onClick={props.onManual}>
                      문서 직접 작성
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {off && (
            <div className="note" data-tone="danger" role="alert">
              <div className="note-main">
                <span className="note-body">{view.agent.message}</span>
                <div className="button-row">
                  <button className="btn btn-sm" onClick={props.onManual}>
                    문서 직접 작성
                  </button>
                </div>
              </div>
            </div>
          )}
          {limit && !off && (
            <p className="help concept-limit">
              대화 횟수({view.max_user_turns}번)를 모두 썼습니다. 지금 초안으로
              문서를 만들거나 처음부터 다시 시작하세요.
            </p>
          )}
        </div>
        <div className="concept-compose">
          <textarea
            ref={box}
            value={input}
            rows={2}
            maxLength={MAX_TEXT}
            readOnly={!canSend}
            aria-label="에이전트에게 보낼 답"
            placeholder={
              writing
                ? "문서를 쓰는 중입니다"
                : busy
                  ? "답을 기다리는 중입니다"
                  : "답을 입력하세요"
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={keydown}
          />
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!canSend || !input.trim()}
          >
            보내기
          </button>
        </div>
        <p className="concept-hint">
          Enter 보내기 · Shift+Enter 줄 바꿈
          {input.length > MAX_TEXT - 300 && (
            <span className="num">
              {" "}
              · {input.length}/{MAX_TEXT}
            </span>
          )}
        </p>
      </section>
      <div className="concept-foot">
        <button
          className="btn btn-ghost"
          onClick={() => void start(true)}
          disabled={busy || loading}
        >
          <RotateCcw className="icon icon-sm" aria-hidden />
          처음부터 다시
        </button>
        <span className="concept-foot-note">
          {writing
            ? "문서를 쓰고 있습니다. 보통 1분 안팎 걸립니다."
            : {
                open: "문서가 준비되었습니다. 만든 문서 열기를 누르면 문서 직접 작성 탭에서 확인하고 고칠 수 있습니다.",
                again:
                  "문서를 만든 뒤 대화가 이어졌습니다. 바뀐 내용으로 문서를 다시 만들 수 있습니다.",
                make: "이제 문서를 만들 수 있습니다. 1분 정도 걸립니다.",
                off: "질문 몇 개에 답하면 요구사항과 디자인 문서를 만들 수 있습니다.",
              }[action]}
        </span>
        {action === "open" ? (
          <button
            className="btn btn-primary"
            onClick={() => docs && openDocs(docs)}
            disabled={busy}
          >
            <FileText className="icon icon-sm" aria-hidden />
            만든 문서 열기
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void compose()}
            disabled={action === "off" || busy || off}
          >
            {action === "again" ? (
              <>
                <RefreshCw className="icon icon-sm" aria-hidden />
                바뀐 내용으로 문서 다시 만들기
              </>
            ) : (
              <>
                <FileText className="icon icon-sm" aria-hidden />이 컨셉으로
                문서 만들기
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
