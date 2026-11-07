import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronRight,
  CirclePause,
  Coffee,
  Flower2,
  Images,
  MessageCircle,
  PersonStanding,
  SquareTerminal,
  Stethoscope,
  Timer,
  Workflow,
  Wrench,
} from "lucide-react";
import { shotUrl, useJson } from "./data";
import { Showcase, type ShowcaseData } from "./Showcase";

interface Health {
  version: string;
  read_only: boolean;
}

// The first line typed here is handed to 대화로 만들기 on the dashboard
// (Concept.tsx reads it once). It only fills the chat box; sending stays there.
const SEED = "homepage-concept-seed";
const MAX_TEXT = 2000;

// Sections below the fold rise in once when they enter the viewport. Content
// is never hidden for reduced motion (landing.css only animates otherwise).
function useReveal() {
  useEffect(() => {
    const items = [...document.querySelectorAll<HTMLElement>(".lp-reveal")];
    if (!("IntersectionObserver" in window)) {
      for (const el of items) el.dataset.in = "";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.in = "";
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of items) io.observe(el);
    return () => io.disconnect();
  }, []);
}

const crew: {
  key: string;
  name: string;
  role: string;
  body: string;
  meta: string;
}[] = [
  {
    key: "concept",
    name: "상담 에이전트",
    role: "질문과 문서",
    body: "대화로 만들기 창에서 질문을 하나씩 던져 컨셉 카드를 채우고, 정리되면 prd.md와 design.md 초안을 씁니다. 도구 없이 대답만 하고, 제작 요청은 직접 보내지 않습니다.",
    meta: "claude -p · 도구 없음",
  },
  {
    key: "broker",
    name: "브로커",
    role: "순서와 기록",
    body: "요청을 큐에 넣고 자리가 나면 Herdr workspace를 만들어 PM을 띄웁니다. 태스크를 하나씩 배정하고 모든 상태를 JSON으로 남깁니다. 결과가 불분명한 작업은 다시 보내지 않고 멈춥니다.",
    meta: "로컬 프로그램 · 동시 2개",
  },
  {
    key: "pm",
    name: "Claude PM",
    role: "기획부터 구현까지",
    body: "프로젝트마다 한 명이 방향, 첫 화면, 전체 페이지를 차례로 직접 만듭니다. look.py로 데스크톱과 휴대폰 화면을 찍어 보고 스스로 고칩니다.",
    meta: "Opus 5.5 · effort high",
  },
  {
    key: "image",
    name: "이미지 서브에이전트",
    role: "사진과 그림",
    body: "PM이 정한 프롬프트와 저장 경로를 받아 Higgsfield MCP로 이미지를 동시에 여러 장 만듭니다. 디자인과 카피는 건드리지 않습니다.",
    meta: "Higgsfield MCP · PM이 호출",
  },
];
const avatar = (key: string) => `/landing/agent-${key}.webp`;

const examples: {
  icon: ReactNode;
  tone: string;
  title: string;
  tags: string;
  text: string;
}[] = [
  {
    icon: <Coffee className="icon" aria-hidden />,
    tone: "attn",
    title: "카페·베이커리",
    tags: "메뉴 · 예약 · 오시는 길",
    text: "망원동 동네 빵집 '온기'. 오늘 구운 빵 목록과 홀케이크 예약을 받는 따뜻한 느낌의 홈페이지",
  },
  {
    icon: <PersonStanding className="icon" aria-hidden />,
    tone: "ok",
    title: "필라테스·요가",
    tags: "수업 · 강사 · 체험 신청",
    text: "역삼동 1:1 필라테스 '숨'. 강사 소개와 수업 종류, 체험 수업 신청 폼이 있는 차분한 홈페이지",
  },
  {
    icon: <Stethoscope className="icon" aria-hidden />,
    tone: "accent",
    title: "치과·클리닉",
    tags: "진료 과목 · 의료진 · 예약",
    text: "강남 치과 '바른이'. 진료 과목과 의료진 소개, 비급여 가격 안내, 예약 문의를 받는 신뢰감 있는 홈페이지",
  },
  {
    icon: <Flower2 className="icon" aria-hidden />,
    tone: "danger",
    title: "꽃집·공방",
    tags: "구독 · 클래스 · 갤러리",
    text: "연남동 꽃집 '바람결'. 꽃 정기 구독과 원데이 클래스 신청을 받고 작업 사진을 보여 주는 홈페이지",
  },
  {
    icon: <Wrench className="icon" aria-hidden />,
    tone: "accent",
    title: "정비소·수리점",
    tags: "정비 항목 · 견적 · 방문 예약",
    text: "수원 자동차 정비소 '단단모터스'. 정비 항목별 예상 비용과 방문 예약을 받는 믿음직한 홈페이지",
  },
  {
    icon: <Camera className="icon" aria-hidden />,
    tone: "attn",
    title: "스튜디오·작가",
    tags: "포트폴리오 · 촬영 상품 · 문의",
    text: "웨딩·프로필 사진작가 포트폴리오. 작품 12점 갤러리와 촬영 상품, 촬영 문의 폼이 있는 홈페이지",
  },
];

function Header(props: { canRequest: boolean }) {
  return (
    <header className="lp-bar lp-dark" data-theme="dark">
      <div className="lp-wrap lp-bar-in">
        <a className="lp-brand" href="/">
          Homepage Broker
          <span className="badge badge-muted badge-mono">homepage</span>
        </a>
        <nav className="lp-nav" aria-label="랜딩 페이지 구역">
          <a href="#team">팀</a>
          <a href="#examples">예시</a>
          <a href="#showcase">제작 사례</a>
          <a href="#flow">진행 방식</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-bar-actions">
          {props.canRequest && (
            <a
              className="lp-btn lp-btn-sm lp-bar-request"
              href="/dashboard#/request"
            >
              제작 요청
            </a>
          )}
          <a className="lp-btn lp-btn-sm lp-btn-primary" href="/dashboard">
            대시보드
          </a>
        </div>
      </div>
    </header>
  );
}

function LiveLine(props: { data: ShowcaseData | null; error: string | null }) {
  const s = props.data?.summary;
  if (!s)
    return (
      <p className="lp-live" role="status">
        <span className="lp-live-item">
          <span className="dot" data-state={props.error ? "warn" : undefined} />
          {props.error
            ? "브로커 상태를 불러오지 못했습니다"
            : "브로커 상태를 확인하고 있습니다"}
        </span>
      </p>
    );
  return (
    <p className="lp-live num" role="status">
      <span className="lp-live-item">
        <span className="dot" data-state={s.active ? "running" : "ok"} />
        지금 제작 {s.active}/{s.max_parallel}
      </span>
      {s.queued > 0 && <span className="lp-live-item">큐 대기 {s.queued}</span>}
      <span className="lp-live-item">검토 대기 {s.review}</span>
    </p>
  );
}

// Example lines take turns as the placeholder while the box is empty.
function usePlaceholder(on: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setI((n) => (n + 1) % examples.length), 3600);
    return () => clearInterval(t);
  }, [on]);
  return `예) ${examples[i].text}`;
}

function Ask(props: {
  text: string;
  setText: (v: string) => void;
  box: RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const placeholder = usePlaceholder(!props.readOnly && !props.text);
  const value = props.text.trim();
  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (props.readOnly) return;
    if (!value) {
      props.box.current?.focus();
      return;
    }
    try {
      sessionStorage.setItem(SEED, value);
    } catch {
      setNote(
        "브라우저 저장소를 쓸 수 없어 문장을 넘기지 못했습니다. 대시보드의 제작 요청 창에 직접 입력해 주세요.",
      );
      return;
    }
    location.assign("/dashboard#/request");
  }
  // Enter hands the line over; Shift+Enter breaks it. A Korean IME commits
  // its last syllable with Enter, so that keypress is left alone.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    submit(e);
  }
  return (
    <form id="ask" className="lp-ask" onSubmit={submit}>
      <label className="lp-sr" htmlFor="lp-ask-text">
        만들고 싶은 홈페이지를 한 줄로 적기
      </label>
      <div className="lp-ask-box">
        <textarea
          id="lp-ask-text"
          ref={props.box}
          rows={3}
          maxLength={MAX_TEXT}
          value={props.text}
          disabled={props.readOnly}
          placeholder={
            props.readOnly
              ? "읽기 전용 모드에서는 제작 요청을 받지 않습니다"
              : placeholder
          }
          onChange={(e) => {
            props.setText(e.target.value);
            setNote(null);
          }}
          onKeyDown={onKey}
        />
        <div className="lp-ask-row">
          <span className="lp-ask-hint">
            <MessageCircle className="icon icon-sm" aria-hidden />
            대화로 만들기에서 이어집니다
          </span>
          {props.readOnly ? (
            <a className="lp-btn lp-btn-sm" href="/dashboard">
              대시보드 열기
            </a>
          ) : (
            <button
              type="submit"
              className="lp-ask-send"
              disabled={!value}
              aria-label="대화로 만들기에서 이어 쓰기"
            >
              <ArrowUp className="icon" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <p className="lp-ask-note" role={note ? "alert" : undefined}>
        {note ??
          (props.readOnly
            ? "이 브로커는 읽기 전용 모드라 제작 요청을 받지 않습니다. 제작 현황은 대시보드에서 볼 수 있습니다."
            : "Enter로 넘기고 Shift+Enter로 줄을 바꿉니다. 문장은 대시보드의 대화로 만들기 입력칸에 채워지고, 보내기는 그 창에서 직접 누릅니다.")}
      </p>
    </form>
  );
}

function Recent(props: { data: ShowcaseData | null }) {
  const items = (props.data?.projects ?? []).filter((p) => p.shots.mobile);
  if (!props.data) return null;
  if (!items.length)
    return (
      <a className="lp-recent" href="#flow">
        <Workflow className="icon" aria-hidden />
        <span className="lp-recent-text">세 단계로 만드는 과정 먼저 보기</span>
        <ChevronRight className="icon icon-sm lp-recent-go" aria-hidden />
      </a>
    );
  const s = props.data.summary;
  return (
    <a className="lp-recent" href="#showcase">
      <Images className="icon" aria-hidden />
      <span className="lp-recent-text">
        브로커가 만든 홈페이지
        <span className="muted num">
          {" "}
          납품 {s.delivered}
          {s.showcased > s.delivered &&
            ` · 제작 중 ${s.showcased - s.delivered}`}
        </span>
      </span>
      <span className="lp-recent-thumbs" aria-hidden>
        {items.slice(0, 4).map((p) => (
          <img
            key={p.project_id}
            src={shotUrl(p.project_id, p.shots.mobile!)}
            alt=""
            decoding="async"
          />
        ))}
      </span>
      <ChevronRight className="icon icon-sm lp-recent-go" aria-hidden />
    </a>
  );
}

function Hero(props: {
  data: ShowcaseData | null;
  error: string | null;
  text: string;
  setText: (v: string) => void;
  box: RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean;
}) {
  return (
    <section
      className="lp-hero lp-dark"
      data-theme="dark"
      aria-labelledby="lp-hero-title"
    >
      <div className="lp-wrap lp-hero-in">
        <LiveLine data={props.data} error={props.error} />
        <ul className="lp-crew" aria-label="제작 팀">
          {crew.map((c) => (
            <li key={c.key}>
              <img
                src={avatar(c.key)}
                width={480}
                height={480}
                alt={c.name}
                fetchPriority="high"
              />
            </li>
          ))}
        </ul>
        <h1 id="lp-hero-title" className="lp-h1">
          어떤 홈페이지를 만들까요?
        </h1>
        <p className="lp-lead">
          한 줄로 시작하면 <b>상담 에이전트</b>가 질문으로 컨셉을 정리하고,{" "}
          <b>Claude PM</b>이 방향부터 전체 페이지까지 만들어 localhost
          미리보기로 넘깁니다.
        </p>
        <Ask
          text={props.text}
          setText={props.setText}
          box={props.box}
          readOnly={props.readOnly}
        />
        <Recent data={props.data} />
      </div>
    </section>
  );
}

function Head(props: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="lp-head lp-reveal">
      <p className="lp-eyebrow">{props.eyebrow}</p>
      <h2 id={props.id} className="lp-h2">
        {props.title}
      </h2>
      {props.children && <p className="lp-lead">{props.children}</p>}
    </div>
  );
}

function Team() {
  return (
    <section id="team" className="lp-section" aria-labelledby="lp-team-title">
      <div className="lp-wrap">
        <Head
          id="lp-team-title"
          eyebrow="팀"
          title="요청 하나에 넷이 손발을 맞춥니다"
        >
          상담과 제작은 Claude가, 순서와 기록은 브로커가 맡습니다. 프로젝트마다
          PM은 한 명입니다.
        </Head>
        <ul className="lp-team">
          {crew.map((c) => (
            <li key={c.key} className="lp-member lp-reveal">
              <div className="lp-member-head">
                <img
                  src={avatar(c.key)}
                  width={480}
                  height={480}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <div>
                  <h3 className="lp-h4">{c.name}</h3>
                  <p className="lp-member-role">{c.role}</p>
                </div>
              </div>
              <p className="lp-body">{c.body}</p>
              <p className="lp-member-meta mono">{c.meta}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Examples(props: {
  onPick: (text: string) => void;
  readOnly: boolean;
}) {
  return (
    <section
      id="examples"
      className="lp-section lp-tint"
      aria-labelledby="lp-examples-title"
    >
      <div className="lp-wrap">
        <Head
          id="lp-examples-title"
          eyebrow="예시"
          title="업종을 고르면 첫 문장을 채워 드립니다"
        >
          {props.readOnly
            ? "어떤 문장으로 시작하면 되는지 업종별로 모았습니다. 읽기 전용 모드에서는 예시만 볼 수 있습니다."
            : "누르면 위 입력칸에 예시 문장이 들어갑니다. 가게 이름과 꼭 넣을 내용만 바꿔 쓰면 됩니다."}
        </Head>
        <ul className="lp-examples">
          {examples.map((x) => {
            const inner = (
              <>
                <span className="lp-example-icon" data-tone={x.tone}>
                  {x.icon}
                </span>
                <span className="lp-example-title">{x.title}</span>
                <span className="lp-example-tags">{x.tags}</span>
                <span className="lp-example-text">{x.text}</span>
                {!props.readOnly && (
                  <span className="lp-example-go">
                    이 문장으로 시작{" "}
                    <ArrowUp className="icon icon-sm" aria-hidden />
                  </span>
                )}
              </>
            );
            return (
              <li key={x.title} className="lp-reveal">
                {props.readOnly ? (
                  <div className="lp-example">{inner}</div>
                ) : (
                  <button
                    type="button"
                    className="lp-example"
                    onClick={() => props.onPick(x.text)}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const steps: {
  task: string;
  name: string;
  title: string;
  body: string;
  out: string;
  alt: string;
}[] = [
  {
    task: "direction",
    name: "방향",
    title: "방향을 한 파일에 정합니다",
    body: "요청 문서를 읽고 세 질문에 답합니다. 누구를 위한 페이지인지, 같은 업종 사이에서 무엇이 다른지, 방문자가 왜 그 버튼을 누르는지. 섹션 구성과 필요한 이미지, 색·글자·모션 방향까지 40줄 안에 적습니다.",
    out: "reports/direction.md",
    alt: "흰 안전모를 쓴 빨간 공 모양 캐릭터가 작은 나무 책상에서 연필로 화면 구성 스케치를 그리고 있습니다.",
  },
  {
    task: "first-screen",
    name: "첫 화면",
    title: "첫 화면부터 완성합니다",
    body: "히어로와 대표 섹션 하나를 실제 카피·이미지·모션까지 넣어 완성된 수준으로 만들고 미리보기를 띄웁니다. 이미지는 Claude에 연결된 Higgsfield MCP로 만듭니다. look 1회차를 보고 판정에 걸리면 고쳐서 2회차로 한 번 더 봅니다.",
    out: "look 1·2회차 · 미리보기 시작",
    alt: "빨간 캐릭터가 발판에 올라 큰 브라우저 창의 윗부분에 풍경 그림이 든 첫 화면을 붙이고 있고, 아래는 아직 점선으로 비어 있습니다.",
  },
  {
    task: "build-out",
    name: "전체 페이지",
    title: "나머지를 채우고 납품 화면을 남깁니다",
    body: "남은 섹션과 이미지, 폼·계산기처럼 요청한 기능을 실제로 동작하게 만듭니다. 3회차부터 전체 페이지를 조각내어 보고 고친 뒤, 마지막 final 회차를 납품 증거로 찍습니다. final 이후에는 고치지 않습니다.",
    out: "look 3회차부터 · final",
    alt: "칸이 모두 채워진 브라우저 창 앞에서 네 캐릭터가 손을 들고 완성을 반기고 있습니다.",
  },
];

function Flow() {
  return (
    <section
      id="flow"
      className="lp-section lp-tint"
      aria-labelledby="lp-flow-title"
    >
      <div className="lp-wrap">
        <Head
          id="lp-flow-title"
          eyebrow="진행 방식"
          title="PM 한 명이 세 단계를 차례로 끝냅니다"
        >
          브로커는 태스크를 하나씩 배정하고, PM은 단계를 마칠 때마다 보고합니다.
          화면을 만드는 단계에서는 look.py가 데스크톱 1440px과 휴대폰 390px
          화면을 찍고, PM이 그 스크린샷을 직접 보고 고칩니다.
        </Head>
        <ol className="lp-steps">
          {steps.map((s, i) => (
            <li key={s.task} className="lp-step lp-reveal">
              <figure className="lp-step-art">
                <img
                  src={`/landing/step-${s.task}.webp`}
                  width={1280}
                  height={956}
                  alt={s.alt}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
              <div className="lp-step-copy">
                <p className="lp-step-tag">
                  <span className="lp-step-no num">{i + 1}</span>
                  {s.name}
                  <code className="badge badge-mono">{s.task}</code>
                </p>
                <h3 className="lp-h3">{s.title}</h3>
                <p className="lp-body">{s.body}</p>
                <p className="lp-step-out">
                  <span className="muted">남는 것</span>
                  <code>{s.out}</code>
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="lp-review lp-reveal">
          <span className="badge" data-tone="ok">
            검토 대기
          </span>
          <p>
            모든 태스크가 끝나고 미리보기가 준비되면 프로젝트는 검토 대기가
            됩니다. Herdr pane이 idle이라는 것만으로는 납품으로 보지 않습니다.
            고칠 점은 피드백으로 보내면 새 run에서 이어서 작업합니다.
          </p>
        </div>
      </div>
    </section>
  );
}

const watch: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <SquareTerminal className="icon" aria-hidden />,
    title: "터미널 미러",
    body: "PM이 일하는 Herdr pane 화면을 읽기 전용으로 비춥니다. 브라우저에서 pane으로 입력을 보내지 않습니다.",
  },
  {
    icon: <Images className="icon" aria-hidden />,
    title: "진행 단계와 스크린샷",
    body: "세 단계의 진행 막대, look 회차별 데스크톱·휴대폰 화면과 판정 메모, 활동 기록을 프로젝트마다 모아 봅니다.",
  },
  {
    icon: <Timer className="icon" aria-hidden />,
    title: "응답 없음 감지",
    body: "PM이 태스크를 맡은 채 정해진 시간(기본 5분) 동안 상태가 바뀌지 않으면 경고를 띄우고 Herdr 알림을 한 번 보냅니다. 업무 상태는 바꾸지 않습니다.",
  },
  {
    icon: <Workflow className="icon" aria-hidden />,
    title: "구조도",
    body: "브라우저에서 웹 서버, 브로커, Herdr 세션, PM pane까지 요청이 지나는 길과 지금 상태를 한 화면에 그립니다.",
  },
  {
    icon: <CirclePause className="icon" aria-hidden />,
    title: "확인 없이 다시 보내지 않습니다",
    body: "결과가 불분명한 외부 작업은 자동으로 재전송하지 않고 프로젝트를 일시정지합니다. 브로커가 재시작되어도 작업 재개를 직접 눌러야 이어집니다.",
  },
];

function Watch() {
  return (
    <section id="watch" className="lp-section" aria-labelledby="lp-watch-title">
      <div className="lp-wrap">
        <Head
          id="lp-watch-title"
          eyebrow="지켜보기"
          title="맡겨 둔 동안에도 과정이 보입니다"
        >
          대시보드는 브로커 상태를 1초마다 받아 다시 그립니다. 보는 화면과
          바꾸는 명령이 나뉘어 있어, 지켜보는 동안 작업을 건드리지 않습니다.
        </Head>
        <ul className="lp-watch">
          {watch.map((w) => (
            <li key={w.title} className="lp-watch-item lp-reveal">
              <span className="lp-watch-icon">{w.icon}</span>
              <h3 className="lp-h4">{w.title}</h3>
              <p className="lp-body">{w.body}</p>
            </li>
          ))}
          <li className="lp-reveal">
            <a className="lp-watch-cta" href="/dashboard">
              <span className="lp-watch-cta-label">대시보드</span>
              <span className="lp-watch-cta-title">
                지금 돌아가는 프로젝트를 바로 봅니다
              </span>
              <span className="lp-watch-cta-go">
                대시보드 열기{" "}
                <ArrowRight className="icon icon-sm" aria-hidden />
              </span>
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}

const faq: { q: string; a: string }[] = [
  {
    q: "어디에서 실행되나요?",
    a: "브로커와 이 페이지는 내 컴퓨터의 127.0.0.1에서만 열립니다. PM은 Herdr homepage 세션의 pane에서 Claude Code로 일하고, 만든 결과물도 내 컴퓨터의 프로젝트 폴더에 남습니다.",
  },
  {
    q: "한 번에 몇 개까지 만들 수 있나요?",
    a: "동시에 2개 프로젝트까지 만들고, 그 이상은 큐에서 차례를 기다립니다. 기본 설정에서는 대시보드에서 제작 시작을 눌러야 차례가 돌아옵니다. localhost 미리보기도 동시에 2개까지 띄웁니다.",
  },
  {
    q: "무엇을 준비해야 하나요?",
    a: "요구사항(prd.md)과 디자인 지침(design.md) 두 문서가 필요합니다. 문서가 없으면 대화로 만들기에서 질문에 답해 컨셉을 정리하고, 상담 에이전트가 쓴 초안을 확인한 뒤 보내면 됩니다.",
  },
  {
    q: "결과물은 어디에 남나요?",
    a: "기본 위치는 ~/herdr-homepages/<프로젝트 ID>입니다. 코드는 app/에, 이미지와 보고서·스크린샷은 .herdr/runs/<run ID>/ 아래에 남습니다. 검토 대기가 되면 localhost 미리보기로 직접 열어 봅니다.",
  },
  {
    q: "다 만든 뒤 고치고 싶으면요?",
    a: "고칠 점을 피드백으로 보내면 같은 프로젝트에서 새 run이 시작되어 이어서 작업합니다. 피드백은 지금은 CLI의 feedback 명령으로 보냅니다.",
  },
  {
    q: "이미지는 어떻게 만드나요?",
    a: "Claude에 연결된 Higgsfield MCP로 만듭니다. 여러 장이 필요하면 PM이 이미지 서브에이전트에게 나눠 맡겨 동시에 만듭니다. 생성 비용은 연결된 Higgsfield 계정의 크레딧에서 나갑니다.",
  },
  {
    q: "중간에 멈추면 어떻게 되나요?",
    a: "PM이 태스크를 맡은 채 5분(기본값) 동안 상태가 바뀌지 않으면 대시보드에 응답 없음 경고가 뜨고 Herdr 알림이 한 번 옵니다. 결과가 불분명한 작업이 있거나 브로커가 재시작되면 프로젝트가 일시정지되고, 작업 재개를 눌러야 이어집니다.",
  },
];

function Faq() {
  return (
    <section
      id="faq"
      className="lp-section lp-tint"
      aria-labelledby="lp-faq-title"
    >
      <div className="lp-wrap">
        <Head id="lp-faq-title" eyebrow="FAQ" title="자주 묻는 질문" />
        <div className="lp-faq lp-reveal">
          {faq.map((f) => (
            <details key={f.q}>
              <summary>
                {f.q}
                <ChevronDown className="icon lp-faq-mark" aria-hidden />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing(props: { onStart: () => void; readOnly: boolean }) {
  return (
    <section
      className="lp-close lp-dark"
      data-theme="dark"
      aria-labelledby="lp-close-title"
    >
      <div className="lp-wrap lp-close-in">
        <figure className="lp-close-art lp-reveal">
          <img
            src="/landing/team.webp"
            width={1440}
            height={956}
            alt="보라색 알약, 초록 네모, 안전모를 쓴 빨간 공, 카메라를 든 노란 세모 캐릭터가 나란히 서 있습니다."
            loading="lazy"
            decoding="async"
          />
        </figure>
        <div className="lp-close-copy lp-reveal">
          <h2 id="lp-close-title" className="lp-h2">
            오늘 만들 홈페이지를 한 줄로 적어 보세요
          </h2>
          <p className="lp-lead">
            상담 에이전트가 질문으로 문서 초안을 함께 쓰고, 확인해서 보내면
            요청이 큐에 들어갑니다. 차례가 오면 PM이 바로 방향부터 잡습니다.
          </p>
          {props.readOnly ? (
            <a className="lp-btn lp-btn-primary lp-btn-lg" href="/dashboard">
              대시보드 열기 <ArrowRight className="icon" aria-hidden />
            </a>
          ) : (
            <button
              type="button"
              className="lp-btn lp-btn-primary lp-btn-lg"
              onClick={props.onStart}
            >
              첫 문장 쓰러 가기 <ArrowUp className="icon" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer(props: { version?: string }) {
  return (
    <footer className="lp-foot lp-dark" data-theme="dark">
      <div className="lp-wrap lp-foot-in">
        <p>
          <b>Homepage Broker</b>
          {props.version && <span className="num"> v{props.version}</span>}
          <span className="muted">
            {" "}
            · homepage 세션 · 이 페이지는 127.0.0.1에서만 열립니다
          </span>
        </p>
        <nav className="lp-foot-nav" aria-label="바닥글">
          <a href="/dashboard">대시보드</a>
          <a href="/dashboard#/structure">구조도</a>
          <a href="#team">팀</a>
          <a href="#flow">진행 방식</a>
          <a href="#faq">FAQ</a>
        </nav>
      </div>
    </footer>
  );
}

export function Landing() {
  const showcase = useJson<ShowcaseData>("/api/showcase", {
    interval: 30000,
    maxAge: 5000,
  });
  const health = useJson<Health>("/api/health");
  const canRequest = health.data ? !health.data.read_only : false;
  const readOnly = health.data?.read_only === true;
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useReveal();
  // Example cards and the closing button bring the reader back to the box.
  function toBox(fill?: string) {
    if (fill !== undefined) setText(fill);
    // Smooth only where landing.css allows motion (html scroll-behavior).
    document.getElementById("ask")?.scrollIntoView({ block: "center" });
    box.current?.focus({ preventScroll: true });
  }
  return (
    <>
      <Header canRequest={canRequest} />
      <main id="main" tabIndex={-1}>
        <Hero
          data={showcase.data}
          error={showcase.error}
          text={text}
          setText={setText}
          box={box}
          readOnly={readOnly}
        />
        <Team />
        <Examples onPick={toBox} readOnly={readOnly} />
        <Showcase
          data={showcase.data}
          error={showcase.error}
          canRequest={canRequest}
        />
        <Flow />
        <Watch />
        <Faq />
        <Closing onStart={() => toBox()} readOnly={readOnly} />
      </main>
      <Footer version={health.data?.version} />
    </>
  );
}
