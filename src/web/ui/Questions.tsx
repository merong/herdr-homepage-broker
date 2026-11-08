import { useState, type ReactNode } from "react";
import { CircleCheck, CircleQuestionMark } from "lucide-react";

interface Question {
  request_id: string;
  task_id: string;
  kind: string;
  question: string;
  status: string;
  response_schema: any;
}
interface Project {
  project_id: string;
  run_id: string;
  status: string;
  resume_required: boolean;
  input_requests: Question[];
}
interface Receipt {
  request_id: string;
  kind: string;
  status: string;
}

const kindNames: Record<string, string> = {
  execution_choice: "진행 방식 선택",
  requirements_change: "요구사항 변경",
  terminal_action: "터미널 조치",
};
const questionStates: Record<string, string> = {
  open: "답변 대기",
  answered: "답변 완료",
  awaiting_documents: "문서 갱신 대기",
};
// Same retry rule as 제작 시작: an unknown receipt keeps the command_id so the
// same answer sent again is deduplicated by the broker.
const RETRY = ["receipt_unknown", "network", "ECONNREFUSED", "ENOENT"];

type FieldKind = "enum" | "string" | "boolean" | "number" | "json";
interface Field {
  key: string;
  label: string | null;
  schema: any;
  kind: FieldKind;
  required: boolean;
}
function kindOf(s: any): FieldKind {
  if (!s || typeof s !== "object") return "json";
  if (Array.isArray(s.enum) && s.enum.length) return "enum";
  if (s.type === "string") return "string";
  if (s.type === "boolean") return "boolean";
  if (s.type === "number" || s.type === "integer") return "number";
  return "json";
}
// An object schema becomes one field per property; anything else is a single
// field. Unsupported shapes fall back to a JSON box next to the schema.
function fieldsOf(schema: any): { object: boolean; fields: Field[] } {
  const props = schema?.properties;
  if (
    schema?.type === "object" &&
    props &&
    typeof props === "object" &&
    Object.keys(props).length
  ) {
    const required: string[] = Array.isArray(schema.required)
      ? schema.required
      : [];
    return {
      object: true,
      fields: Object.entries(props).map(([key, s]) => ({
        key,
        label: key,
        schema: s,
        kind: kindOf(s),
        required: required.includes(key),
      })),
    };
  }
  return {
    object: false,
    fields: [
      {
        key: "",
        label: null,
        schema,
        kind: kindOf(schema),
        required: true,
      },
    ],
  };
}
type Parsed =
  | { empty: true }
  | { empty: false; value: unknown }
  | { error: string };
function parse(f: Field, raw: string): Parsed {
  if (f.kind === "string")
    return raw ? { empty: false, value: raw } : { empty: true };
  if (!raw.trim()) return { empty: true };
  if (f.kind === "enum")
    return { empty: false, value: f.schema.enum[Number(raw)] };
  if (f.kind === "boolean") return { empty: false, value: raw === "true" };
  if (f.kind === "number") {
    const n = Number(raw);
    return Number.isFinite(n)
      ? { empty: false, value: n }
      : { error: `${f.label ?? "답"}: 숫자를 입력하세요.` };
  }
  try {
    return { empty: false, value: JSON.parse(raw) };
  } catch {
    return { error: `${f.label ?? "답"}: JSON 형식이 올바르지 않습니다.` };
  }
}
function build(
  form: { object: boolean; fields: Field[] },
  values: Record<string, string>,
): { response: unknown } | { error: string } {
  const out: Record<string, unknown> = {};
  for (const f of form.fields) {
    const p = parse(f, values[f.key] ?? "");
    if ("error" in p) return p;
    if (p.empty) {
      if (f.required)
        return {
          error: f.label
            ? `필수 항목 ${f.label}을(를) 채워 주세요.`
            : "답을 입력하세요.",
        };
      continue;
    }
    if (!form.object) return { response: p.value };
    out[f.key] = p.value;
  }
  return { response: out };
}
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
function summary(response: unknown, object: boolean) {
  if (!object) return show(response);
  return Object.entries(response as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${show(v)}`)
    .join("\n");
}

function FieldInput(props: {
  field: Field;
  value: string;
  name: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const { field: f, value, name, disabled, onChange } = props;
  const description =
    typeof f.schema?.description === "string" ? f.schema.description : null;
  const head = (
    <>
      {f.label && (
        <span className="answer-label">
          <span className="mono">{f.label}</span>
          {f.required ? (
            <span className="badge" data-tone="warn">
              필수
            </span>
          ) : (
            <span className="answer-optional">선택</span>
          )}
        </span>
      )}
      {description && <span className="help">{description}</span>}
    </>
  );
  if (f.kind === "enum" || f.kind === "boolean") {
    const options: [string, ReactNode][] =
      f.kind === "enum"
        ? f.schema.enum.map((v: unknown, i: number) => [
            String(i),
            <span className="mono">{show(v)}</span>,
          ])
        : [
            ["true", "예"],
            ["false", "아니요"],
          ];
    return (
      <fieldset className="answer-field" disabled={disabled}>
        {(f.label || description) && <legend>{head}</legend>}
        <div className="answer-choices">
          {options.map(([v, label]) => (
            <label className="answer-choice" key={v}>
              <input
                type="radio"
                name={name}
                value={v}
                checked={value === v}
                onChange={() => onChange(v)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <label className="field answer-field">
      {head}
      {f.kind === "json" && (
        <pre className="json-output answer-schema">
          {JSON.stringify(f.schema ?? {}, null, 2)}
        </pre>
      )}
      {f.kind === "number" ? (
        <input
          type="number"
          step={f.schema?.type === "integer" ? 1 : "any"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          rows={f.kind === "json" ? 5 : 3}
          value={value}
          disabled={disabled}
          placeholder={
            f.kind === "json"
              ? "위 형식에 맞는 JSON"
              : f.required
                ? ""
                : "비워 두어도 됩니다"
          }
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function QuestionForm(props: {
  project: Project;
  question: Question;
  csrf: string | null;
  onAccepted: (r: Receipt) => void;
}) {
  const { project: p, question: q } = props;
  const form = fieldsOf(q.response_schema);
  const storageKey = `homepage-answer:${p.project_id}:${p.run_id}:${q.request_id}`;
  const [values, setValues] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState(false);
  const [confirm, setConfirm] = useState<{
    response: unknown;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const terminal = q.kind === "terminal_action";

  function review() {
    setError(null);
    const built = build(form, values);
    if ("error" in built) {
      setError({ code: "form", message: built.error });
      return;
    }
    setConfirm(built);
  }

  async function send(response: unknown) {
    if (!props.csrf || sending) return;
    const body = {
      project_id: p.project_id,
      run_id: p.run_id,
      request_id: q.request_id,
      response,
      ...(terminal ? { terminal_resolved: true } : {}),
    };
    // The same answer reuses its command_id; a changed answer gets a new one.
    const key = JSON.stringify(body);
    let command_id = crypto.randomUUID();
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved?.key === key && saved.command_id) command_id = saved.command_id;
      sessionStorage.setItem(storageKey, JSON.stringify({ key, command_id }));
    } catch {}
    setSending(true);
    setError(null);
    try {
      let res: Response;
      try {
        res = await fetch("/api/projects/answer", {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            "X-Homepage-Token": props.csrf,
          },
          body: JSON.stringify({ ...body, command_id }),
        });
      } catch {
        throw Object.assign(
          new Error(
            "브로커의 응답을 받지 못했습니다. 같은 답을 다시 보내면 중복 없이 결과를 확인합니다.",
          ),
          { code: "network" },
        );
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), {
          code: data.error ?? "network",
        });
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      setConfirm(null);
      props.onAccepted({
        request_id: q.request_id,
        kind: q.kind,
        status: data.status,
      });
    } catch (e: any) {
      if (!RETRY.includes(e.code)) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        setConfirm(null);
      }
      setError({ code: e.code, message: e.message });
    } finally {
      setSending(false);
    }
  }

  const retry = !!confirm && !!error && RETRY.includes(error.code);
  return (
    <div className="question answer">
      <span className="note-body answer-question">{q.question}</span>
      <span className="meta muted">
        {kindNames[q.kind] ?? q.kind} · 작업{" "}
        <span className="mono">{q.task_id}</span> · 요청{" "}
        <span className="mono">{q.request_id.slice(0, 8)}</span>
      </span>
      {q.kind === "requirements_change" && (
        <span className="help">
          답하면 질문이 문서 갱신 대기(awaiting_documents)로 바뀝니다.
          prd.md·design.md를 고친 뒤 보내는 문서 갱신(apply-inputs)은 아직
          브로커 CLI로 합니다.
        </span>
      )}
      {terminal && (
        <span className="help">
          비밀번호·토큰·인증 코드 같은 비밀값은 답에 적지 마세요. 답은 브로커
          상태에 저장되고 PM에게 그대로 전달됩니다. 인증과 권한 요청은 PM
          pane에서 직접 처리합니다.
        </span>
      )}
      <div className="answer-form">
        {form.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            name={`answer-${q.request_id}-${f.key}`}
            value={values[f.key] ?? ""}
            disabled={!!confirm || sending}
            onChange={(v) => {
              setValues((s) => ({ ...s, [f.key]: v }));
              setError(null);
            }}
          />
        ))}
        {terminal && (
          <label className="answer-check">
            <input
              type="checkbox"
              checked={resolved}
              disabled={!!confirm || sending}
              onChange={(e) => setResolved(e.target.checked)}
            />
            PM pane에서 인증·권한 요청을 직접 처리했습니다
          </label>
        )}
      </div>
      {error && (
        <span className="answer-error" role="alert">
          {error.message}
        </span>
      )}
      {confirm ? (
        <div className="answer-confirm">
          <span className="note-title">PM에게 이 답을 보냅니다</span>
          <pre className="json-output">
            {summary(confirm.response, form.object)}
          </pre>
          {terminal && (
            <span className="help">
              PM pane에서 인증·권한 요청을 처리했다고 함께 알립니다.
            </span>
          )}
          <div className="button-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={sending || !props.csrf}
              onClick={() => void send(confirm.response)}
            >
              {sending
                ? "보내는 중…"
                : retry
                  ? "같은 답 다시 보내기"
                  : "보내기"}
            </button>
            <button
              className="btn btn-sm"
              disabled={sending}
              onClick={() => {
                setConfirm(null);
                setError(null);
              }}
            >
              고치기
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button
            className="btn btn-sm btn-attn"
            disabled={!props.csrf || (terminal && !resolved)}
            onClick={review}
          >
            답 확인하기
          </button>
          {!props.csrf && (
            <span className="help">
              읽기 전용 화면에서는 답을 보낼 수 없습니다.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function nextStep(p: Project, r: Receipt) {
  if (r.status === "awaiting_documents")
    return "prd.md·design.md를 고친 뒤 브로커 CLI의 apply-inputs로 보내세요. 문서 갱신은 아직 웹에서 보내지 않습니다.";
  const open = p.input_requests.filter(
    (q) => q.status !== "answered" && q.request_id !== r.request_id,
  ).length;
  if (open) return `남은 질문 ${open}건에도 답해 주세요.`;
  if (p.resume_required)
    return "작업 재개를 눌러야 PM이 이어서 진행합니다. 재개는 위 안내의 작업 재개 버튼으로 합니다.";
  if (p.status === "queued")
    return "실행 슬롯이 비면 PM이 이어서 진행합니다. 진행 상황은 목록에 실시간으로 반영됩니다.";
  return "PM이 답을 받아 이어서 진행합니다. 진행 상황은 목록에 실시간으로 반영됩니다.";
}

// 사용자 확인: one answer form per open question, built from its
// response_schema. Answers go through POST /api/projects/answer (the broker's
// `answer` command); receipts stay here after the snapshot drops the question.
export function Questions(props: { project: Project; csrf: string | null }) {
  const p = props.project;
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const done = new Set(receipts.map((r) => r.request_id));
  const open = p.input_requests.filter(
    (q) => q.status === "open" && !done.has(q.request_id),
  );
  if (!open.length && !receipts.length) return null;
  return (
    <div className="stack" id="answers">
      {receipts.map((r) => (
        <div className="note" data-tone="ok" key={r.request_id} role="status">
          <CircleCheck className="icon" aria-hidden />
          <div className="note-main">
            <span className="note-title">
              답이 접수되었습니다 · {questionStates[r.status] ?? r.status}
            </span>
            <span className="note-body">{nextStep(p, r)}</span>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() =>
              setReceipts((s) => s.filter((x) => x.request_id !== r.request_id))
            }
          >
            닫기
          </button>
        </div>
      ))}
      {open.length > 0 && (
        <div className="note" data-tone="warn">
          <CircleQuestionMark className="icon" aria-hidden />
          <div className="note-main">
            <span className="note-title">
              사용자 확인이 필요합니다 · {open.length}건
            </span>
            {open.map((q) => (
              <QuestionForm
                key={q.request_id}
                project={p}
                question={q}
                csrf={props.csrf}
                onAccepted={(r) =>
                  setReceipts((s) => [
                    ...s.filter((x) => x.request_id !== r.request_id),
                    r,
                  ])
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
