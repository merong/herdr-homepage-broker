import { useEffect, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  CirclePause,
  Images,
  Plus,
  SquareTerminal,
  Timer,
  Workflow,
} from "lucide-react";
import { shotUrl, useJson } from "./data";
import { Showcase, dateName, type ShowcaseData } from "./Showcase";

interface Health {
  version: string;
  read_only: boolean;
}

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

function Header(props: { canRequest: boolean }) {
  return (
    <header className="lp-bar">
      <div className="lp-wrap lp-bar-in">
        <a className="lp-brand" href="/">
          Homepage Broker
          <span className="badge badge-muted badge-mono">homepage</span>
        </a>
        <nav className="lp-nav" aria-label="랜딩 페이지 구역">
          <a href="#flow">진행 방식</a>
          <a href="#watch">지켜보기</a>
          <a href="#showcase">제작 사례</a>
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

function Hero(props: {
  data: ShowcaseData | null;
  error: string | null;
  canRequest: boolean;
}) {
  const latest =
    props.data?.projects.find((p) => p.delivered && p.shots.mobile) ??
    props.data?.projects.find((p) => p.shots.mobile);
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <LiveLine data={props.data} error={props.error} />
          <h1 id="lp-hero-title" className="lp-h1">
            문서 두 개로 맡기고,
            <br />
            화면으로 확인합니다.
          </h1>
          <p className="lp-lead">
            요구사항(prd.md)과 디자인 지침(design.md)을 넣으면 브로커가 Herdr
            homepage 세션에 프로젝트마다 Claude PM 한 명을 띄웁니다. PM은 방향을
            정하고, 첫 화면과 전체 페이지를 만든 뒤 localhost 미리보기로
            넘깁니다.
          </p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-primary lp-btn-lg" href="/dashboard">
              대시보드 열기
              <ArrowRight className="icon" aria-hidden />
            </a>
            {props.canRequest && (
              <a className="lp-btn lp-btn-lg" href="/dashboard#/request">
                <Plus className="icon" aria-hidden />새 제작 요청
              </a>
            )}
            <a className="lp-text-link" href="#showcase">
              제작 사례 보기 <ArrowDown className="icon icon-sm" aria-hidden />
            </a>
          </div>
        </div>
        <figure className="lp-hero-art">
          <img
            src="/landing/hero.webp"
            width={1600}
            height={1280}
            alt="흰 종이와 나무 막대로 만든 2층 집 건축 모형. 창 하나에 파란 유리가 끼워져 있습니다."
            fetchPriority="high"
          />
          {latest?.shots.mobile && (
            <a className="lp-hero-chip" href="#showcase">
              <span className="lp-hero-phone">
                <img
                  src={shotUrl(latest.project_id, latest.shots.mobile)}
                  alt=""
                  decoding="async"
                />
              </span>
              <span className="lp-hero-chip-text">
                <span className="lp-chip-label">
                  {latest.delivered ? "최근 납품 화면" : "최근 회차 화면"}
                </span>
                <b>{latest.name}</b>
                <span className="muted">{dateName(latest.at)}</span>
              </span>
            </a>
          )}
        </figure>
      </div>
      <div className="lp-wrap">
        <dl className="lp-facts">
          <div>
            <dt>동시 제작</dt>
            <dd>최대 2개 프로젝트</dd>
          </div>
          <div>
            <dt>프로젝트마다</dt>
            <dd>Herdr workspace 1개 · PM 1명</dd>
          </div>
          <div>
            <dt>모델</dt>
            <dd>Claude Opus 5.5 · effort high</dd>
          </div>
          <div>
            <dt>접속</dt>
            <dd>127.0.0.1 전용</dd>
          </div>
        </dl>
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
  image: string;
  alt: string;
}[] = [
  {
    task: "direction",
    name: "방향",
    title: "방향을 한 파일에 정합니다",
    body: "요청 문서를 읽고 세 질문에 답합니다. 누구를 위한 페이지인지, 같은 업종 사이에서 무엇이 다른지, 방문자가 왜 그 버튼을 누르는지. 섹션 구성과 필요한 이미지, 색·글자·모션 방향까지 40줄 안에 적습니다.",
    out: "reports/direction.md",
    image: "/landing/direction.webp",
    alt: "흰 폼보드 덩어리 세 개를 쌓아 만든 집 형태 습작과 연필 스케치, 파란 색지 조각",
  },
  {
    task: "first-screen",
    name: "첫 화면",
    title: "첫 화면부터 완성합니다",
    body: "히어로와 대표 섹션 하나를 실제 카피·이미지·모션까지 넣어 완성된 수준으로 만들고 미리보기를 띄웁니다. 이미지는 Claude에 연결된 Higgsfield MCP로 PM이 직접 만듭니다. look 1회차를 보고 판정에 걸리면 고쳐서 2회차로 한 번 더 봅니다.",
    out: "look 1–2회차 · 미리보기 시작",
    image: "/landing/first-screen.webp",
    alt: "정면 파사드만 세밀하게 완성되고 옆면은 아직 흰 면으로 남은 집 모형",
  },
  {
    task: "build-out",
    name: "전체 페이지",
    title: "나머지를 채우고 납품 화면을 남깁니다",
    body: "남은 섹션과 이미지, 폼·계산기처럼 요청한 기능을 실제로 동작하게 만듭니다. 3회차부터 전체 페이지를 조각내어 보고 고친 뒤, 마지막 final 회차를 납품 증거로 찍습니다. final 이후에는 고치지 않습니다.",
    out: "look 3회차부터 · final",
    image: "/landing/build-out.webp",
    alt: "창마다 불이 켜지고 테라스와 작은 나무까지 완성된 집 모형",
  },
];

function Flow() {
  return (
    <section
      id="flow"
      className="lp-section lp-flow"
      aria-labelledby="lp-flow-title"
    >
      <div className="lp-wrap">
        <div className="lp-section-head lp-reveal">
          <h2 id="lp-flow-title" className="lp-h2">
            PM 한 명이 세 단계를 차례로 끝냅니다
          </h2>
          <p className="lp-lead">
            브로커는 태스크를 하나씩 배정하고, PM은 단계를 마칠 때마다
            보고합니다. 화면을 만드는 단계에서는 look.py가 데스크톱 1440px과
            휴대폰 390px 화면을 찍고, PM이 그 스크린샷을 직접 보고 고칩니다.
          </p>
        </div>
        <ol className="lp-steps">
          {steps.map((s, i) => (
            <li key={s.task} className="lp-step lp-reveal">
              <figure className="lp-step-art">
                <img
                  src={s.image}
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
    <section
      id="watch"
      className="lp-section lp-watch"
      aria-labelledby="lp-watch-title"
    >
      <div className="lp-wrap lp-watch-grid">
        <div className="lp-watch-head lp-reveal">
          <h2 id="lp-watch-title" className="lp-h2">
            맡겨 둔 동안에도 과정이 보입니다
          </h2>
          <p className="lp-lead">
            대시보드는 브로커 상태를 1초마다 받아 다시 그립니다. 보는 화면과
            바꾸는 명령이 나뉘어 있어, 지켜보는 동안 작업을 건드리지 않습니다.
          </p>
          <a className="lp-text-link" href="/dashboard">
            대시보드에서 보기{" "}
            <ArrowRight className="icon icon-sm" aria-hidden />
          </a>
        </div>
        <ul className="lp-watch-list">
          {watch.map((w) => (
            <li key={w.title} className="lp-reveal">
              <span className="lp-watch-icon">{w.icon}</span>
              <div>
                <h3 className="lp-h4">{w.title}</h3>
                <p className="lp-body">{w.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Footer(props: { version?: string }) {
  return (
    <footer className="lp-foot">
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
          <a href="#flow">진행 방식</a>
          <a href="#showcase">제작 사례</a>
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
  useReveal();
  return (
    <>
      <Header canRequest={canRequest} />
      <main id="main" tabIndex={-1}>
        <Hero
          data={showcase.data}
          error={showcase.error}
          canRequest={canRequest}
        />
        <Flow />
        <Watch />
        <Showcase
          data={showcase.data}
          error={showcase.error}
          canRequest={canRequest}
        />
      </main>
      <Footer version={health.data?.version} />
    </>
  );
}
