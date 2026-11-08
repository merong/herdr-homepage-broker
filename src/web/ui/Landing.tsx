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
  Camera,
  Check,
  ChevronDown,
  CirclePause,
  Coffee,
  Flower2,
  Images,
  LayoutPanelTop,
  MonitorCheck,
  Palette,
  PencilLine,
  PersonStanding,
  ScanSearch,
  Sparkles,
  SquareTerminal,
  Stethoscope,
  Timer,
  Workflow,
  Wrench,
} from "lucide-react";
import { useJson } from "./data";
import { Showcase, type ShowcaseData } from "./Showcase";
import {
  CAST,
  Character,
  Spark,
  useInView,
  type CastId,
  type Tone,
} from "./Cast";

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

function useMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [ok, setOk] = useState(() => !matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setOk(!m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return ok;
}

const crew: { id: CastId; role: string; body: string; meta: string }[] = [
  {
    id: "concept",
    role: "질문과 문서",
    body: "대화로 만들기 창에서 질문을 하나씩 던져 컨셉 카드를 채우고, 정리되면 prd.md와 design.md 초안을 씁니다. 도구 없이 대답만 하고, 제작 요청은 직접 보내지 않습니다.",
    meta: "claude -p · 도구 없음",
  },
  {
    id: "broker",
    role: "순서와 기록",
    body: "요청을 큐에 넣고 자리가 나면 Herdr workspace를 만들어 PM을 띄웁니다. 태스크를 하나씩 배정하고 모든 상태를 JSON으로 남깁니다. 결과가 불분명한 작업은 다시 보내지 않고 멈춥니다.",
    meta: "로컬 프로그램 · 동시 2개",
  },
  {
    id: "pm",
    role: "기획부터 구현까지",
    body: "프로젝트마다 한 명이 방향, 첫 화면, 전체 페이지를 차례로 직접 만듭니다. look.py로 데스크톱과 휴대폰 화면을 찍어 보고 스스로 고칩니다.",
    meta: "Opus 5.5 · effort high",
  },
  {
    id: "image",
    role: "사진과 그림",
    body: "PM이 정한 프롬프트와 저장 경로를 받아 Higgsfield MCP로 이미지를 동시에 여러 장 만듭니다. 디자인과 카피는 건드리지 않습니다.",
    meta: "Higgsfield MCP · PM이 호출",
  },
  {
    id: "seo",
    role: "검색과 공유",
    body: "전체 페이지 단계에서 PM이 부르면 title, description, Open Graph, JSON-LD, robots.txt를 입력 문서의 사실만으로 넣습니다. 본문의 제목 구조나 alt 문제는 고치지 않고 PM에게 돌려줍니다.",
    meta: "서브에이전트 · reports/seo.md",
  },
  {
    id: "security",
    role: "노출과 외부 요청",
    body: "SEO 에이전트와 함께 불려 소스와 미리보기를 읽기만 하면서 비밀값, 열리면 안 되는 파일, 외부 요청, 폼 전송처를 점검합니다. 높음·중간 항목은 PM이 납품 화면을 찍기 전에 고칩니다.",
    meta: "서브에이전트 · 읽기 전용 · reports/security.md",
  },
];

// Industry examples: the chip fills the box with `text`, and the browser in
// the hero draws a made-up site for it while the stages run.
interface Site {
  chip: string;
  icon: ReactNode;
  tone: Tone;
  hint: string;
  text: string;
  name: string;
  slug: string;
  tagline: string;
  menu: string[];
  cta: string;
}
const sites: Site[] = [
  {
    chip: "카페·빵집",
    icon: <Coffee className="icon" aria-hidden />,
    tone: "yellow",
    hint: "망원동 빵집 '온기' 홈페이지 만들어 줘",
    text: "망원동 동네 빵집 '온기'. 오늘 구운 빵 목록과 홀케이크 예약을 받는 따뜻한 느낌의 홈페이지",
    name: "온기",
    slug: "ongi-bakery",
    tagline: "오늘 아침 구운 빵",
    menu: ["오늘의 빵", "케이크 예약", "오시는 길"],
    cta: "케이크 예약",
  },
  {
    chip: "꽃집·공방",
    icon: <Flower2 className="icon" aria-hidden />,
    tone: "coral",
    hint: "연남동 꽃집 '바람결' 홈페이지 만들어 줘",
    text: "연남동 꽃집 '바람결'. 꽃 정기 구독과 원데이 클래스 신청을 받고 작업 사진을 보여 주는 홈페이지",
    name: "바람결",
    slug: "baramgyeol",
    tagline: "계절 꽃 정기 구독",
    menu: ["꽃 구독", "클래스", "갤러리"],
    cta: "구독 신청",
  },
  {
    chip: "필라테스",
    icon: <PersonStanding className="icon" aria-hidden />,
    tone: "sage",
    hint: "역삼동 필라테스 '숨' 홈페이지 만들어 줘",
    text: "역삼동 1:1 필라테스 '숨'. 강사 소개와 수업 종류, 체험 수업 신청 폼이 있는 차분한 홈페이지",
    name: "숨",
    slug: "soom-pilates",
    tagline: "몸의 균형을 찾는 1:1 수업",
    menu: ["수업", "강사", "체험 신청"],
    cta: "체험 신청",
  },
  {
    chip: "치과·클리닉",
    icon: <Stethoscope className="icon" aria-hidden />,
    tone: "blue",
    hint: "강남 치과 '바른이' 홈페이지 만들어 줘",
    text: "강남 치과 '바른이'. 진료 과목과 의료진 소개, 비급여 가격 안내, 예약 문의를 받는 신뢰감 있는 홈페이지",
    name: "바른이",
    slug: "bareuni-dental",
    tagline: "진료 과목과 의료진 안내",
    menu: ["진료", "의료진", "가격"],
    cta: "예약 문의",
  },
  {
    chip: "정비소",
    icon: <Wrench className="icon" aria-hidden />,
    tone: "coral",
    hint: "수원 정비소 '단단모터스' 홈페이지 만들어 줘",
    text: "수원 자동차 정비소 '단단모터스'. 정비 항목별 예상 비용과 방문 예약을 받는 믿음직한 홈페이지",
    name: "단단모터스",
    slug: "dandan-motors",
    tagline: "정비 항목별 예상 비용",
    menu: ["정비 항목", "견적", "방문 예약"],
    cta: "방문 예약",
  },
  {
    chip: "스튜디오",
    icon: <Camera className="icon" aria-hidden />,
    tone: "violet",
    hint: "사진작가 '빛결' 포트폴리오 만들어 줘",
    text: "웨딩·프로필 사진작가 '빛결'의 포트폴리오. 작품 12점 갤러리와 촬영 상품, 촬영 문의 폼이 있는 홈페이지",
    name: "빛결",
    slug: "bitgyeol-studio",
    tagline: "웨딩·프로필 포트폴리오",
    menu: ["작품", "촬영 상품", "문의"],
    cta: "촬영 문의",
  },
];

function Header(props: { canRequest: boolean }) {
  return (
    <header className="lp-bar">
      <div className="lp-wrap lp-bar-in">
        <a className="lp-brand" href="/">
          <span className="lp-mark" aria-hidden>
            <i />
            <i />
          </span>
          Homepage Broker
        </a>
        <nav className="lp-nav" aria-label="랜딩 페이지 구역">
          <a href="#team">팀</a>
          <a href="#flow">진행 방식</a>
          <a href="#showcase">제작 사례</a>
          <a href="#watch">지켜보기</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-bar-actions">
          <a className="lp-btn lp-btn-sm" href="/dashboard">
            대시보드
          </a>
          {props.canRequest && (
            <a
              className="lp-btn lp-btn-sm lp-btn-coral lp-bar-request"
              href="/dashboard#/request"
            >
              제작 요청
            </a>
          )}
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
      <span className="lp-live-item">납품 {s.delivered}</span>
    </p>
  );
}

// Short example lines take turns as the placeholder while the box is empty.
function usePlaceholder(on: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setI((n) => (n + 1) % sites.length), 3600);
    return () => clearInterval(t);
  }, [on]);
  return `예) ${sites[i].hint}`;
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
        <PencilLine className="icon lp-ask-pen" aria-hidden />
        <textarea
          id="lp-ask-text"
          ref={props.box}
          rows={1}
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
        {props.readOnly ? (
          <a className="lp-btn lp-btn-coral lp-ask-send" href="/dashboard">
            대시보드 열기
          </a>
        ) : (
          <button
            type="submit"
            className="lp-btn lp-btn-coral lp-ask-send"
            disabled={!value}
          >
            대화로 이어 쓰기 <Sparkles className="icon icon-sm" aria-hidden />
          </button>
        )}
      </div>
      <p className="lp-ask-note" role={note ? "alert" : undefined}>
        {note ??
          (props.readOnly
            ? "이 브로커는 읽기 전용 모드라 제작 요청을 받지 않습니다. 제작 현황은 대시보드에서 볼 수 있습니다."
            : "Enter로 대화로 만들기 입력칸에 옮겨 적고, 보내기는 그 창에서 직접 누릅니다. 줄바꿈은 Shift+Enter.")}
      </p>
    </form>
  );
}

// The PM's stages, drawn as the four visor bots. They take turns while the
// hero is on screen; with reduced motion the row rests on the finished state.
const stages: {
  id: CastId;
  doing: string;
  done: string;
  tile: ReactNode;
}[] = [
  {
    id: "direction",
    doing: "색과 글꼴 고르는 중",
    done: "방향 정리 끝",
    tile: <Palette className="icon" aria-hidden />,
  },
  {
    id: "first-screen",
    doing: "히어로 쓰는 중",
    done: "첫 화면 완성",
    tile: <LayoutPanelTop className="icon" aria-hidden />,
  },
  {
    id: "look",
    doing: "1440·390 찍는 중",
    done: "검수 통과",
    tile: <ScanSearch className="icon" aria-hidden />,
  },
  {
    id: "build-out",
    doing: "섹션 채우는 중",
    done: "final 촬영 끝",
    tile: <MonitorCheck className="icon" aria-hidden />,
  },
];
const DONE = stages.length;

function useStage(ref: RefObject<HTMLElement | null>, motion: boolean) {
  const seen = useInView(ref);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!motion || !seen) return;
    const t = setInterval(() => {
      if (!document.hidden) setTick((n) => (n + 1) % (DONE + 2));
    }, 2200);
    return () => clearInterval(t);
  }, [motion, seen]);
  return motion ? Math.min(tick, DONE) : DONE;
}

function Pipeline(props: { site: Site; motion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useStage(ref, props.motion);
  return (
    <div className="lp-pipe" ref={ref}>
      <ol className="lp-pipe-stages" aria-label="Claude PM의 작업 단계">
        {stages.map((s, i) => {
          const state = stage > i ? "done" : stage === i ? "doing" : "wait";
          return (
            <li
              key={s.id}
              className="lp-pipe-stage"
              data-state={state}
              data-tone={CAST[s.id].tone}
            >
              <span className="lp-pipe-bubble" aria-hidden>
                {state === "done" ? (
                  <>
                    {s.done} <Check className="icon icon-sm" />
                  </>
                ) : state === "doing" ? (
                  <>
                    {s.doing}
                    <span className="lp-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </>
                ) : (
                  "차례 대기"
                )}
              </span>
              <span className="lp-pipe-fig">
                <Character
                  id={s.id}
                  active={state === "doing"}
                  mood={stage === DONE ? "happy" : undefined}
                  delay={i * 0.4}
                />
              </span>
              <span className="lp-pipe-link" data-state={state} aria-hidden>
                <span className="lp-pipe-tile">{s.tile}</span>
              </span>
              <span className="lp-pipe-label">{CAST[s.id].name}</span>
            </li>
          );
        })}
      </ol>
      <p className="lp-pipe-status" aria-hidden>
        {stage === DONE
          ? "네 단계 끝 · 검토 대기"
          : `${CAST[stages[stage].id].name} · ${stages[stage].doing}`}
      </p>
      <Mock site={props.site} stage={stage} />
    </div>
  );
}

// A made-up site for the picked example, filled in as the stages pass.
function Mock(props: { site: Site; stage: number }) {
  const { site, stage } = props;
  const on = (v: boolean) => (v ? "" : undefined);
  return (
    <div className="lp-mock" data-tone={site.tone} aria-hidden>
      <div className="lp-mock-bar">
        <span className="lp-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-mock-url mono">localhost · {site.slug}</span>
        <span className="lp-mock-ready" data-on={on(stage === DONE)}>
          <Check className="icon icon-xs" />
          검토 대기
        </span>
      </div>
      <div className="lp-mock-page">
        <div className="lp-mock-nav" data-on={on(stage >= 1)}>
          <b>{site.name}</b>
          <span>
            {site.menu.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </span>
        </div>
        <div className="lp-mock-hero" data-on={on(stage >= 1)}>
          <span className="lp-mock-copy">
            <b>{site.name}</b>
            <span>{site.tagline}</span>
            <i>{site.cta} ›</i>
          </span>
          <span className="lp-mock-art">{site.icon}</span>
        </div>
        <div className="lp-mock-cards" data-on={on(stage >= 3)}>
          <i />
          <i />
          <i />
        </div>
        <div className="lp-mock-foot" data-on={on(stage >= 3)} />
        <span className="lp-mock-swatch" data-on={on(stage === 0)}>
          <i />
          <i />
          <i />
        </span>
        <span className="lp-mock-scan" data-on={on(stage === 2)}>
          <b>1440 ✓</b>
          <b>390 ✓</b>
        </span>
      </div>
    </div>
  );
}

function Chips(props: {
  pick: number;
  onPick: (i: number) => void;
  readOnly: boolean;
}) {
  return (
    <div id="examples" className="lp-chips-wrap">
      <div className="lp-chips" role="group" aria-label="업종 예시">
        {sites.map((s, i) => (
          <button
            key={s.chip}
            type="button"
            className="lp-chip"
            data-tone={s.tone}
            aria-pressed={props.pick === i}
            onClick={() => props.onPick(i)}
          >
            {s.icon}
            {s.chip}
          </button>
        ))}
      </div>
      <p className="lp-chips-note">
        {props.readOnly
          ? "업종을 누르면 위 미리보기 그림이 바뀝니다."
          : "업종을 누르면 예시 문장이 입력칸에 들어갑니다. 가게 이름과 꼭 넣을 내용만 바꿔 쓰면 됩니다."}
      </p>
    </div>
  );
}

function Hero(props: {
  data: ShowcaseData | null;
  error: string | null;
  text: string;
  setText: (v: string) => void;
  box: RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean;
  pick: number;
  onPick: (i: number) => void;
  motion: boolean;
}) {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-wrap lp-hero-in">
        <p className="lp-badge">
          <Sparkles className="icon icon-sm" aria-hidden />
          Herdr에서 일하는 로컬 AI 제작 팀
        </p>
        <h1 id="lp-hero-title" className="lp-h1">
          한 줄만 적으세요,
          <br />
          나머지는 <mark>에이전트 팀</mark>이!
          <Spark className="lp-h1-spark" />
        </h1>
        <p className="lp-lead">
          <b>상담 에이전트</b>가 질문으로 문서를 정리하고, <b>Claude PM</b>이
          방향부터 전체 페이지까지 만듭니다. <b>SEO·보안 에이전트</b>의 점검을
          거쳐 localhost 미리보기로 넘깁니다.
        </p>
        <Ask
          text={props.text}
          setText={props.setText}
          box={props.box}
          readOnly={props.readOnly}
        />
        <LiveLine data={props.data} error={props.error} />
        <Pipeline site={sites[props.pick]} motion={props.motion} />
        <Chips
          pick={props.pick}
          onPick={props.onPick}
          readOnly={props.readOnly}
        />
      </div>
    </section>
  );
}

function Head(props: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="lp-head lp-reveal">
      <h2 id={props.id} className="lp-h2">
        {props.title}
        <Spark className="lp-head-spark" />
      </h2>
      {props.children && <p className="lp-head-sub">{props.children}</p>}
    </div>
  );
}

function Team() {
  return (
    <section id="team" className="lp-section" aria-labelledby="lp-team-title">
      <div className="lp-wrap">
        <Head id="lp-team-title" title="요청 하나에 여섯이 손발을 맞춥니다">
          상담과 제작, 점검은 Claude가, 순서와 기록은 브로커가 맡습니다.
          프로젝트마다 PM은 한 명이고, 이미지·SEO·보안 에이전트는 PM이 필요할 때
          부르는 서브에이전트입니다.
        </Head>
        <ul className="lp-team">
          {crew.map((c, i) => (
            <li
              key={c.id}
              className="lp-member lp-reveal"
              data-tone={CAST[c.id].tone}
            >
              <Character id={c.id} delay={i * 0.6} />
              <div className="lp-member-copy">
                <p className="lp-member-role">{c.role}</p>
                <h3 className="lp-h3">{CAST[c.id].name}</h3>
                <p className="lp-body">{c.body}</p>
                <p className="lp-member-meta mono">{c.meta}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const outputs: { task: string; out: string }[] = [
  { task: "direction", out: "reports/direction.md · 섹션·이미지·색 방향" },
  { task: "first-screen", out: "look 1·2회차 · 미리보기 시작" },
  {
    task: "build-out",
    out: "SEO·보안 점검 · look 3회차부터 · final 납품 화면",
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
        <Head id="lp-flow-title" title="어떻게 진행되나요?">
          한 줄을 적고 나면 나머지는 팀이 차례로 이어 갑니다.
        </Head>
        <ol className="lp-flow">
          <li className="lp-flow-step lp-reveal" data-tone="violet">
            <p className="lp-flow-title">
              <span className="lp-flow-no num">1</span>한 줄 적기
            </p>
            <p className="lp-body">
              대화로 만들기에서 상담 에이전트의 질문에 답하면 prd.md와 design.md
              초안이 생깁니다. 확인하고 보내면 요청이 큐에 들어갑니다.
            </p>
            <span className="lp-flow-art lp-flow-talk" aria-hidden>
              <span className="lp-flow-say">
                "동네 빵집 홈페이지 만들어 줘"
              </span>
              <Character id="concept" />
            </span>
          </li>
          <li className="lp-flow-step lp-flow-wide lp-reveal" data-tone="coral">
            <p className="lp-flow-title">
              <span className="lp-flow-no num">2</span>PM이 단계를 끝냅니다
            </p>
            <p className="lp-body">
              브로커가 자리를 배정하면 Claude PM이 방향, 첫 화면, 전체 페이지를
              차례로 만들고 look.py 스크린샷으로 스스로 검수합니다. 전체 페이지
              단계에서는 SEO·보안 에이전트가 함께 점검합니다.
            </p>
            <span className="lp-flow-art lp-flow-bots" aria-hidden>
              {stages.map((s, i) => (
                <Character key={s.id} id={s.id} delay={i * 0.25} />
              ))}
            </span>
          </li>
          <li className="lp-flow-step lp-reveal" data-tone="sage">
            <p className="lp-flow-title">
              <span className="lp-flow-no num">3</span>검토 대기
            </p>
            <p className="lp-body">
              모든 태스크가 끝나고 미리보기가 준비되면 검토 대기가 됩니다. Herdr
              pane이 idle이라는 것만으로는 납품으로 보지 않습니다.
            </p>
            <span className="lp-flow-art lp-flow-done" aria-hidden>
              <span className="lp-flow-window">
                <span className="lp-mock-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <Check className="icon" />
              </span>
              <Character id="broker" />
            </span>
          </li>
        </ol>
        <ul className="lp-outs lp-reveal" aria-label="단계마다 남는 것">
          {outputs.map((o) => (
            <li key={o.task}>
              <code className="badge badge-mono">{o.task}</code>
              <span>{o.out}</span>
            </li>
          ))}
        </ul>
        <p className="lp-flow-note lp-reveal">
          고칠 점은 피드백으로 보내면 같은 프로젝트의 새 run에서 이어서
          작업합니다.
        </p>
      </div>
    </section>
  );
}

const watch: { icon: ReactNode; tone: Tone; title: string; body: string }[] = [
  {
    icon: <SquareTerminal className="icon" aria-hidden />,
    tone: "coral",
    title: "터미널 미러",
    body: "PM이 일하는 Herdr pane 화면을 읽기 전용으로 비춥니다. 브라우저에서 pane으로 입력을 보내지 않습니다.",
  },
  {
    icon: <Images className="icon" aria-hidden />,
    tone: "sage",
    title: "진행 단계와 스크린샷",
    body: "세 단계의 진행 막대, look 회차별 데스크톱·휴대폰 화면과 판정 메모, 활동 기록을 프로젝트마다 모아 봅니다.",
  },
  {
    icon: <Timer className="icon" aria-hidden />,
    tone: "yellow",
    title: "응답 없음 감지",
    body: "PM이 태스크를 맡은 채 정해진 시간(기본 5분) 동안 상태가 바뀌지 않으면 경고를 띄우고 Herdr 알림을 한 번 보냅니다. 업무 상태는 바꾸지 않습니다.",
  },
  {
    icon: <Workflow className="icon" aria-hidden />,
    tone: "violet",
    title: "구조도",
    body: "브라우저에서 웹 서버, 브로커, Herdr 세션, PM pane까지 요청이 지나는 길과 지금 상태를 한 화면에 그립니다.",
  },
  {
    icon: <CirclePause className="icon" aria-hidden />,
    tone: "blue",
    title: "확인 없이 다시 보내지 않습니다",
    body: "결과가 불분명한 외부 작업은 자동으로 재전송하지 않고 프로젝트를 일시정지합니다. 브로커가 재시작되어도 작업 재개를 직접 눌러야 이어집니다.",
  },
];

function Watch() {
  return (
    <section id="watch" className="lp-section" aria-labelledby="lp-watch-title">
      <div className="lp-wrap">
        <Head id="lp-watch-title" title="맡겨 둔 동안에도 과정이 보입니다">
          보는 화면과 바꾸는 명령이 나뉘어 있어, 지켜보는 동안 작업을 건드리지
          않습니다.
        </Head>
        <ul className="lp-watch">
          {watch.map((w) => (
            <li
              key={w.title}
              className="lp-watch-item lp-reveal"
              data-tone={w.tone}
            >
              <span className="lp-watch-icon">{w.icon}</span>
              <h3 className="lp-h4">{w.title}</h3>
              <p className="lp-body">{w.body}</p>
            </li>
          ))}
          <li className="lp-reveal">
            <a className="lp-watch-cta" href="/dashboard">
              <span className="lp-watch-cta-title">
                지금 돌아가는 프로젝트를 바로 봅니다
              </span>
              <span className="lp-watch-cta-go">
                대시보드 열기{" "}
                <ArrowRight className="icon icon-sm" aria-hidden />
              </span>
              <span className="lp-watch-cta-cast" aria-hidden>
                <Character id="pm" />
                <Character id="look" delay={0.5} />
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
    q: "SEO와 보안은 누가 챙기나요?",
    a: "전체 페이지 단계에서 PM이 SEO 에이전트와 보안 에이전트를 한 번씩 동시에 부릅니다. SEO 에이전트는 입력 문서의 사실만으로 메타 태그, Open Graph, robots.txt를 넣고, 보안 에이전트는 소스와 미리보기를 읽기만 하면서 비밀값, 내부 파일 노출, 외부 요청을 찾습니다. 결과는 reports/seo.md와 reports/security.md에 남고, 보안 높음·중간 항목은 납품 화면을 찍기 전에 고칩니다. 배포 서버 설정이나 외부 취약점 조회는 하지 않습니다.",
  },
  {
    q: "중간에 멈추면 어떻게 되나요?",
    a: "PM이 태스크를 맡은 채 5분(기본값) 동안 상태가 바뀌지 않으면 대시보드에 응답 없음 경고가 뜨고 Herdr 알림이 한 번 옵니다. 결과가 불분명한 작업이 있거나 브로커가 재시작되면 프로젝트가 일시정지되고, 작업 재개를 눌러야 이어집니다.",
  },
  {
    q: "그림 속 캐릭터는 실제 에이전트인가요?",
    a: "알약·네모·공·세모 캐릭터는 상담 에이전트, 브로커, Claude PM, 이미지 서브에이전트이고, 차트 팻말을 든 하늘색 로봇과 방패를 든 파란 로봇은 SEO·보안 서브에이전트입니다. 붓·연필·돋보기·로켓을 든 로봇 넷은 PM 한 명이 거치는 단계(방향, 첫 화면, 검수, 전체 페이지)를 그린 것으로, 따로 실행되는 에이전트가 아닙니다.",
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
        <Head id="lp-faq-title" title="자주 묻는 질문">
          실행 위치, 동시 제작 수, 결과물 위치를 모았습니다.
        </Head>
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

const cheer: CastId[] = [
  "concept",
  "direction",
  "broker",
  "first-screen",
  "pm",
  "look",
  "image",
  "build-out",
  "seo",
  "security",
];

function Closing(props: { onStart: () => void; readOnly: boolean }) {
  return (
    <section className="lp-close" aria-labelledby="lp-close-title">
      <div className="lp-wrap">
        <div className="lp-close-band lp-reveal">
          <h2 id="lp-close-title" className="lp-close-title">
            오늘 만들 홈페이지,
            <br />
            <u>한 줄로</u> 맡겨 보세요
          </h2>
          <div className="lp-close-cast" aria-hidden>
            {cheer.map((id, i) => (
              <Character
                key={id}
                id={id}
                mood="happy"
                delay={i * 0.18}
                className="lp-cheer"
              />
            ))}
          </div>
          {props.readOnly ? (
            <a className="lp-btn lp-btn-coral lp-btn-lg" href="/dashboard">
              대시보드 열기 <ArrowRight className="icon" aria-hidden />
            </a>
          ) : (
            <button
              type="button"
              className="lp-btn lp-btn-coral lp-btn-lg"
              onClick={props.onStart}
            >
              첫 문장 쓰러 가기 <Sparkles className="icon" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer(props: { version?: string }) {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-in">
        <p className="lp-foot-brand">
          <span className="lp-mark lp-mark-sm" aria-hidden>
            <i />
            <i />
          </span>
          <b>Homepage Broker</b>
          {props.version && <span className="num"> v{props.version}</span>}
          <span className="muted">
            {" "}
            · 한 줄로 시작하는 로컬 홈페이지 제작 팀 · 127.0.0.1에서만 열립니다
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
  const motion = useMotion();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(1);
  const box = useRef<HTMLTextAreaElement>(null);
  useReveal();
  // Chips and the closing button bring the reader back to the box.
  function toBox(fill?: string) {
    if (fill !== undefined) setText(fill);
    // Smooth only where landing.css allows motion (html scroll-behavior).
    document.getElementById("ask")?.scrollIntoView({ block: "nearest" });
    box.current?.focus({ preventScroll: true });
  }
  function onPick(i: number) {
    setPick(i);
    if (!readOnly) toBox(sites[i].text);
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
          pick={pick}
          onPick={onPick}
          motion={motion}
        />
        <Team />
        <Flow />
        <Showcase
          data={showcase.data}
          error={showcase.error}
          canRequest={canRequest}
        />
        <Watch />
        <Faq />
        <Closing onStart={() => toBox()} readOnly={readOnly} />
      </main>
      <Footer version={health.data?.version} />
    </>
  );
}
