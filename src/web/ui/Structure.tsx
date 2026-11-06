import type { ReactNode } from "react";
import { statusNames } from "./data";

interface Agent {
  role: string;
  pane_id: string | null;
  runtime: { status: string; fresh: boolean };
}
interface Project {
  project_id: string;
  status: string;
  orchestration: { mode: string } | null;
  tasks: { task_id: string; status: string }[];
  agents: Agent[];
  preview: { status: string; url: string | null };
  stall: { minutes: number } | null;
}
interface Brief {
  project_id: string;
  status: string;
}

function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="10"
        refY="5"
        markerWidth="9"
        markerHeight="9"
        markerUnits="userSpaceOnUse"
        orient="auto"
      >
        <path className="dg-arrow" d="M0 0 L10 5 L0 10 z" />
      </marker>
    </defs>
  );
}

function Node(props: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  lines?: string[];
  mono?: boolean;
  center?: boolean;
  active?: boolean;
  tone?: string;
  kind?: string;
}) {
  const { x, y, w = 176, h = 88 } = props;
  const tx = props.center ? x + w / 2 : x + 16;
  const anchor = props.center ? "middle" : "start";
  return (
    <g
      className="dg-node"
      data-active={props.active ? "true" : undefined}
      data-tone={props.tone}
      data-kind={props.kind}
    >
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text
        className={props.mono ? "dg-label dg-mono" : "dg-label"}
        x={tx}
        y={y + 26}
        textAnchor={anchor}
      >
        {props.title}
      </text>
      {(props.lines ?? []).map((line, i) => (
        <text
          key={i}
          className="dg-sub"
          x={tx}
          y={y + 46 + i * 18}
          textAnchor={anchor}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Edge(props: {
  d: string;
  marker: string;
  soft?: boolean;
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <>
      <path
        className="dg-edge"
        data-kind={props.soft ? "soft" : undefined}
        d={props.d}
        markerEnd={`url(#${props.marker})`}
      />
      {props.label && (
        <text
          className="dg-edge-label"
          x={props.lx}
          y={props.ly}
          textAnchor={props.anchor ?? "middle"}
        >
          {props.label}
        </text>
      )}
    </>
  );
}

function Box(props: {
  title: string;
  note: string;
  children: ReactNode;
  legend?: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <span>{props.title}</span>
        <span>{props.note}</span>
      </div>
      <div className="diagram-box">
        {props.children}
        {props.legend && <div className="legend">{props.legend}</div>}
      </div>
    </section>
  );
}

function System({ p }: { p: Project | null }) {
  const pm = p?.agents.find((a) => a.role === "pm") ?? p?.agents[0];
  const pmState = pm?.runtime.fresh ? pm.runtime.status : "—";
  return (
    <svg
      className="diagram"
      viewBox="-4 0 1208 424"
      role="img"
      aria-labelledby="sys-title sys-desc"
    >
      <title id="sys-title">시스템 구성도</title>
      <desc id="sys-desc">
        브라우저는 HTTP와 SSE로 웹 서버에, 웹 서버는 IPC로 브로커 코어에
        붙습니다. 코어는 Herdr CLI로 PM pane에 지시하고 화면을 읽습니다. PM은
        broker-cli로 작업을 보고하고 Higgsfield MCP 도구를 씁니다. 코어는 상태
        저장소에 기록하고 미리보기 서버를 실행합니다.
      </desc>
      <Arrow id="sys-ah" />
      <rect
        className="dg-frame"
        x={232}
        y={56}
        width={480}
        height={360}
        rx={12}
      />
      <text className="dg-frame-label" x={248} y={78}>
        브로커 프로세스
      </text>
      <Edge d="M176 140 H255" marker="sys-ah" label="HTTP" lx={204} ly={130} />
      <Edge d="M432 140 H511" marker="sys-ah" label="IPC" lx={472} ly={130} />
      <Edge
        d="M688 140 H767"
        marker="sys-ah"
        label="CLI · API"
        lx={728}
        ly={130}
      />
      <Edge
        d="M944 140 H1023"
        marker="sys-ah"
        label="prompt · read"
        lx={984}
        ly={130}
      />
      <Edge
        d="M1112 96 V40 H600 V95"
        marker="sys-ah"
        soft
        label="작업 보고 · broker-cli"
        lx={856}
        ly={32}
      />
      <Edge
        d="M600 184 V244 H344 V303"
        marker="sys-ah"
        label="기록"
        lx={354}
        ly={280}
        anchor="start"
      />
      <Edge
        d="M600 244 V303"
        marker="sys-ah"
        label="실행 · 검증"
        lx={610}
        ly={280}
        anchor="start"
      />
      <Edge
        d="M1112 184 V303"
        marker="sys-ah"
        label="MCP 도구"
        lx={1122}
        ly={248}
        anchor="start"
      />
      <Node
        x={0}
        y={96}
        title="브라우저"
        lines={["웹 UI · 127.0.0.1 전용", "같은 출처 + CSRF"]}
      />
      <Node
        x={256}
        y={96}
        title="웹 서버"
        lines={[":7318 · SSE 1초", "터미널 · 스크린샷 읽기"]}
      />
      <Node
        x={512}
        y={96}
        title="브로커 코어"
        lines={["broker.sock · 단일 writer", "500ms tick · 멈춤 감지"]}
      />
      <Node
        x={768}
        y={96}
        title="Herdr 세션"
        lines={["homepage", "workspace · pane"]}
      />
      <Node
        x={1024}
        y={96}
        title={pm?.pane_id ? `PM pane · ${pm.pane_id}` : "PM pane"}
        lines={[
          p ? p.project_id : "Claude Opus 5.5 · high",
          p ? `Herdr ${pmState}` : "프로젝트마다 1개",
        ]}
        active={!!pm?.pane_id && pm.runtime.fresh}
        tone={p?.stall ? "warn" : undefined}
      />
      <Node
        x={256}
        y={304}
        kind="store"
        title="상태 저장소"
        lines={["broker-checkpoint.json", "events.jsonl · run.json"]}
      />
      <Node
        x={512}
        y={304}
        title="미리보기 서버"
        lines={[
          "localhost · 최대 2개",
          p?.preview.url ? p.preview.url.replace(/^http:\/\//, "") : "",
        ]}
        active={p?.preview.status === "ready"}
      />
      <Node
        x={1024}
        y={304}
        title="Higgsfield MCP"
        lines={["Claude 연결 재사용", "이미지 생성"]}
      />
    </svg>
  );
}

const steps: {
  phase: string;
  items: { id: string; title: string; note: string }[];
}[] = [
  {
    phase: "1 · 접수",
    items: [
      {
        id: "request",
        title: "제작 요청",
        note: "웹 또는 CLI에서 PRD와 디자인 문서를 받습니다.",
      },
      {
        id: "init",
        title: "초기화",
        note: "폴더 · 문서 · 요청 JSON을 만듭니다.",
      },
      {
        id: "queued",
        title: "큐 접수",
        note: "제작 시작을 누르면 슬롯을 기다립니다.",
      },
    ],
  },
  {
    phase: "2 · 제작 · PM 1명",
    items: [
      { id: "starting", title: "제작 시작", note: "슬롯 배정 · PM pane 준비" },
      {
        id: "direction",
        title: "direction",
        note: "디자인 판독과 방향을 정합니다.",
      },
      {
        id: "first-screen",
        title: "first-screen",
        note: "첫 화면 · look 1–2회차",
      },
      {
        id: "build-out",
        title: "build-out",
        note: "전체 완성 · look 3회차 이상",
      },
    ],
  },
  {
    phase: "3 · 납품",
    items: [
      {
        id: "preview",
        title: "미리보기 검증",
        note: "미리보기 서버를 켜고 최종 스크린샷을 찍습니다.",
      },
      {
        id: "review_pending",
        title: "검토 대기",
        note: "소스와 미리보기를 검토합니다.",
      },
    ],
  },
];

// Where a project sits in the production flow.
function stepOf(p: Project | (Brief & Partial<Project>)): string | null {
  if (p.status === "queued") return "queued";
  if (p.status === "starting") return "starting";
  if (p.status === "review_pending") return "review_pending";
  if (!["running", "retrying", "waiting_input"].includes(p.status)) return null;
  const tasks = p.tasks ?? [];
  const current = tasks.find((t) =>
    ["running", "retrying", "waiting_input"].includes(t.status),
  );
  if (
    current &&
    ["direction", "first-screen", "build-out"].includes(current.task_id)
  )
    return current.task_id;
  if (tasks.length && tasks.every((t) => t.status === "completed"))
    return "preview";
  return current ? "build-out" : "starting";
}

function Workflow({
  p,
  projects,
}: {
  p: Project | null;
  projects: (Brief & Partial<Project>)[];
}) {
  const here = p ? stepOf(p) : null;
  return (
    <div className="stack">
      {steps.map((phase) => (
        <div key={phase.phase}>
          <div className="section-head">
            <span>{phase.phase}</span>
          </div>
          <div className="group">
            {phase.items.map((s) => {
              const at = projects.filter((x) => stepOf(x) === s.id);
              return (
                <div
                  className="group-row"
                  key={s.id}
                  aria-current={here === s.id ? "step" : undefined}
                >
                  <span
                    className="dot"
                    data-state={
                      here === s.id ? "running" : at.length ? "ok" : undefined
                    }
                  />
                  <div className="v">
                    <div className="ui">{s.title}</div>
                    <div className="meta muted">{s.note}</div>
                  </div>
                  <div className="badge-row">
                    {at.slice(0, 3).map((x) => (
                      <span
                        className="badge badge-mono"
                        key={x.project_id}
                        data-tone={
                          x.project_id === p?.project_id ? "ok" : undefined
                        }
                      >
                        {x.project_id}
                      </span>
                    ))}
                    {at.length > 3 && (
                      <span className="badge">+{at.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="help">
        PM이 질문을 보내면 waiting_input으로 멈추고, 답변하면 큐로 돌아가 같은
        단계부터 이어갑니다. 결과 피드백은 새 run으로 이 흐름을 처음부터 다시
        탑니다.
      </p>
    </div>
  );
}

const stateNodes: {
  key: string;
  x: number;
  y: number;
  sub: string;
  tone?: string;
}[] = [
  { key: "paused", x: 0, y: 40, sub: "일시정지 · 재개 필요" },
  { key: "queued", x: 0, y: 200, sub: "큐 대기" },
  { key: "starting", x: 256, y: 200, sub: "PM pane 준비" },
  { key: "retrying", x: 512, y: 40, sub: "재시도", tone: "warn" },
  { key: "running", x: 512, y: 200, sub: "실행 중" },
  { key: "waiting_input", x: 512, y: 360, sub: "입력 필요", tone: "warn" },
  { key: "superseded", x: 768, y: 40, sub: "새 run으로 대체" },
  { key: "cancelling", x: 768, y: 360, sub: "취소 정리 중" },
  {
    key: "failed",
    x: 1024,
    y: 40,
    sub: "예약 · 현재 전이 없음",
    tone: "danger",
  },
  {
    key: "review_pending",
    x: 1024,
    y: 200,
    sub: "검토 대기 · 납품",
    tone: "ok",
  },
  { key: "cancelled", x: 1024, y: 360, sub: "취소됨" },
];

function States({ p, projects }: { p: Project | null; projects: Brief[] }) {
  const count = (k: string) => projects.filter((x) => x.status === k).length;
  return (
    <svg
      className="diagram"
      viewBox="-4 0 1184 456"
      role="img"
      aria-labelledby="st-title st-desc"
    >
      <title id="st-title">상태 전이도</title>
      <desc id="st-desc">
        queued에서 슬롯을 받으면 starting, pane이 준비되면 running입니다.
        running은 태스크 실패 때 retrying을 거쳐 돌아오고, 질문하면
        waiting_input, 답변하면 queued로 돌아갑니다. 완료되면
        review_pending입니다. 일시정지하면 paused, 재개하면 queued입니다. 입력
        반영은 superseded, 취소는 cancelling을 거쳐 cancelled입니다.
      </desc>
      <Arrow id="st-ah" />
      <rect
        className="dg-frame"
        x={232}
        y={16}
        width={456}
        height={432}
        rx={12}
      />
      <text className="dg-frame-label" x={248} y={36}>
        슬롯 사용 중
      </text>
      <Edge
        d="M152 232 H255"
        marker="st-ah"
        label="슬롯 배정"
        lx={204}
        ly={222}
      />
      <Edge
        d="M408 232 H511"
        marker="st-ah"
        label="pane 준비"
        lx={460}
        ly={222}
      />
      <Edge
        d="M567 200 V105"
        marker="st-ah"
        label="태스크 실패"
        lx={558}
        ly={156}
        anchor="end"
      />
      <Edge
        d="M613 104 V199"
        marker="st-ah"
        label="재배정"
        lx={622}
        ly={156}
        anchor="start"
      />
      <Edge
        d="M588 264 V359"
        marker="st-ah"
        label="질문"
        lx={598}
        ly={316}
        anchor="start"
      />
      <Edge
        d="M512 392 H76 V265"
        marker="st-ah"
        label="답변"
        lx={294}
        ly={382}
      />
      <Edge d="M232 72 H153" marker="st-ah" label="일시정지" lx={192} ly={62} />
      <Edge
        d="M76 104 V199"
        marker="st-ah"
        label="재개"
        lx={86}
        ly={156}
        anchor="start"
      />
      <Edge
        d="M664 232 H1023"
        marker="st-ah"
        label="완료 · 미리보기 ready"
        lx={844}
        ly={222}
      />
      <Edge
        d="M688 72 H767"
        marker="st-ah"
        label="입력 반영"
        lx={728}
        ly={62}
      />
      <Edge d="M688 392 H767" marker="st-ah" label="취소" lx={728} ly={382} />
      <Edge
        d="M920 392 H1023"
        marker="st-ah"
        label="정리 완료"
        lx={972}
        ly={382}
      />
      {stateNodes.map((n) => {
        const c = count(n.key);
        return (
          <Node
            key={n.key}
            x={n.x}
            y={n.y}
            w={152}
            h={64}
            center
            mono
            title={n.key}
            lines={[`${statusNames[n.key]}${c ? ` · ${c}개` : ""}`]}
            active={p?.status === n.key}
            tone={n.tone}
          />
        );
      })}
    </svg>
  );
}

export function Structure({
  project,
  projects,
}: {
  project: Project | null;
  projects: Brief[];
}) {
  return (
    <div className="stack">
      <p className="help">
        구성 요소의 연결과, 선택한 프로젝트가 흐름과 상태 전이에서 어디에 있는지
        보여줍니다.
        {project
          ? ` 선택: ${project.project_id} · ${statusNames[project.status] ?? project.status}`
          : " 선택한 프로젝트가 없습니다."}
      </p>
      <Box
        title="시스템 구성도"
        note="구성 요소 8개"
        legend={
          <>
            <span>실선: 요청·지시</span>
            <span>점선: PM이 보내는 보고</span>
            <span>파란 테두리: 지금 동작 중</span>
            <span>주황 테두리: 응답 없음</span>
          </>
        }
      >
        <System p={project} />
      </Box>
      <section className="section">
        <div className="section-head">
          <span>제작 워크플로우</span>
          <span>접수 → 제작 → 납품</span>
        </div>
        <Workflow
          p={project}
          projects={projects as (Brief & Partial<Project>)[]}
        />
      </section>
      <Box
        title="상태 전이도"
        note="run 상태 11개"
        legend={
          <>
            <span>파란 테두리: 선택한 프로젝트의 현재 상태</span>
            <span>failed: 타입에만 있는 예약 상태</span>
          </>
        }
      >
        <States p={project} projects={projects} />
      </Box>
      <p className="help">
        일시정지는 브로커 재시작, 외부 작업 결과 불명, pane 소유권 불일치·소멸,
        준비 실패 때 일어나며 재개를 눌러야 큐로 돌아갑니다. 취소와 입력 반영은
        종료되지 않은 모든 상태에서 가능합니다.
      </p>
    </div>
  );
}
