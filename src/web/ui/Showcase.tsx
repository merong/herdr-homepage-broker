import { useRef, useState } from "react";
import { ArrowRight, ExternalLink, Maximize2, Sparkles, X } from "lucide-react";
import { roundName, shotUrl } from "./data";
import { Character, Spark } from "./Cast";

interface ShotRef {
  path: string;
  mtime: string;
}
export interface CaseItem {
  project_id: string;
  name: string;
  status: string;
  round: string;
  stage: string;
  at: string;
  rounds: number;
  delivered: boolean;
  shots: {
    desktop: ShotRef | null;
    mobile: ShotRef | null;
    desktop_full: ShotRef | null;
    mobile_full: ShotRef | null;
  };
  preview_url: string | null;
}
export interface ShowcaseData {
  summary: {
    projects: number;
    showcased: number;
    delivered: number;
    active: number;
    queued: number;
    review: number;
    max_parallel: number;
  };
  projects: CaseItem[];
}

export const dateName = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
const dashboardLink = (id: string) => `/dashboard#/p/${encodeURIComponent(id)}`;

function when(p: CaseItem) {
  if (p.delivered) return `${dateName(p.at)} 납품`;
  return `${roundName(p.round)} · ${dateName(p.at)}`;
}

// Full-page screenshots are long (5,000–10,000px), so the viewer scrolls them
// inside the dialog and switches between the desktop and phone captures.
function useViewer() {
  const ref = useRef<HTMLDialogElement>(null);
  const [item, setItem] = useState<CaseItem | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  // Phones open the phone capture first; it reads without zooming.
  const open = (p: CaseItem) => {
    const phone = !!(p.shots.mobile_full || p.shots.mobile);
    const desk = !!(p.shots.desktop_full || p.shots.desktop);
    const narrow = matchMedia("(max-width: 599px)").matches;
    setItem(p);
    setViewport(phone && (narrow || !desk) ? "mobile" : "desktop");
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const shot =
    item &&
    (viewport === "desktop"
      ? (item.shots.desktop_full ?? item.shots.desktop)
      : (item.shots.mobile_full ?? item.shots.mobile));
  const view = (
    <dialog
      ref={ref}
      className="lp-viewer"
      aria-labelledby="lp-viewer-title"
      onClick={(e) => e.target === ref.current && close()}
      onClose={() => setItem(null)}
    >
      <div className="lp-viewer-head">
        <h2 id="lp-viewer-title" className="lp-viewer-title">
          {item?.name}
        </h2>
        <div className="segments" role="tablist" aria-label="화면 크기">
          {(["desktop", "mobile"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              className="segment"
              aria-selected={viewport === v}
              disabled={
                !item ||
                !(v === "desktop"
                  ? item.shots.desktop_full || item.shots.desktop
                  : item.shots.mobile_full || item.shots.mobile)
              }
              onClick={() => setViewport(v)}
            >
              {v === "desktop" ? "데스크톱 1440" : "휴대폰 390"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="닫기"
          onClick={close}
        >
          <X className="icon" aria-hidden />
        </button>
      </div>
      <div className="lp-viewer-body" data-viewport={viewport}>
        {item && shot && (
          <img
            key={shot.path}
            src={shotUrl(item.project_id, shot)}
            alt={`${item.name} ${viewport === "desktop" ? "데스크톱" : "휴대폰"} 전체 화면`}
            decoding="async"
          />
        )}
      </div>
      {item && (
        <div className="lp-viewer-foot">
          <span className="muted">
            {when(item)} · look.py {item.delivered ? "final" : "최근"} 회차
          </span>
          <a className="lp-text-link" href={dashboardLink(item.project_id)}>
            대시보드에서 보기{" "}
            <ArrowRight className="icon icon-sm" aria-hidden />
          </a>
        </div>
      )}
    </dialog>
  );
  return { open, view };
}

// Each case sits in a small browser frame, as in the hero; the phone capture
// stays one click away in the viewer.
function Case(props: {
  p: CaseItem;
  index: number;
  open: (p: CaseItem) => void;
}) {
  const { p } = props;
  const desktop = p.shots.desktop ?? p.shots.desktop_full;
  const mobile = p.shots.mobile ?? p.shots.mobile_full;
  const cover = desktop ?? mobile;
  return (
    <article
      className="lp-case"
      style={{ animationDelay: `${Math.min(props.index, 6) * 70}ms` }}
    >
      <button
        type="button"
        className="lp-case-media"
        onClick={() => props.open(p)}
        aria-label={`${p.name} 전체 화면 크게 보기`}
      >
        <span className="lp-case-tag">
          {p.delivered ? "final 납품 화면" : `${roundName(p.round)} 화면`}
          <Sparkles className="icon icon-xs" aria-hidden />
        </span>
        <span className="lp-case-frame">
          <span className="lp-case-bar" aria-hidden>
            <span className="lp-mock-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="lp-case-url mono">{p.project_id}</span>
          </span>
          <span className="lp-case-desk" data-phone={desktop ? undefined : ""}>
            {cover && (
              <img
                src={shotUrl(p.project_id, cover)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            )}
          </span>
        </span>
        <span className="lp-case-zoom" aria-hidden>
          <Maximize2 className="icon icon-sm" />
        </span>
      </button>
      <div className="lp-case-body">
        <div className="lp-case-title">
          <h3>{p.name}</h3>
          <span className="badge" data-tone={p.delivered ? "ok" : undefined}>
            {p.delivered ? "납품" : "제작 중"}
          </span>
        </div>
        <p className="lp-case-meta">
          {when(p)} · look {p.rounds}회
        </p>
        <div className="lp-case-links">
          <a className="lp-text-link" href={dashboardLink(p.project_id)}>
            대시보드에서 보기{" "}
            <ArrowRight className="icon icon-sm" aria-hidden />
          </a>
          {p.preview_url && (
            <a
              className="lp-text-link"
              href={p.preview_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              미리보기 열기{" "}
              <ExternalLink className="icon icon-sm" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function Showcase(props: {
  data: ShowcaseData | null;
  error: string | null;
  canRequest: boolean;
}) {
  const viewer = useViewer();
  const { data, error } = props;
  const delivered = data?.summary.delivered ?? 0;
  const making = (data?.summary.showcased ?? 0) - delivered;
  let body;
  if (!data)
    body = error ? (
      <div className="lp-empty" role="status">
        <p className="lp-empty-title">제작 사례를 불러오지 못했습니다</p>
        <p>
          브로커 연결을 확인하고 있습니다. 잠시 후 자동으로 다시 시도합니다 (
          {error}).
        </p>
      </div>
    ) : (
      <div className="lp-cases" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="lp-case lp-case-skeleton" />
        ))}
      </div>
    );
  else if (!data.projects.length)
    body = (
      <div className="lp-empty">
        <span className="lp-empty-cast" aria-hidden>
          <Character id="pm" />
          <Character id="image" delay={0.4} />
        </span>
        <p className="lp-empty-title">아직 화면이 남은 프로젝트가 없습니다</p>
        <p>
          제작을 요청하면 PM이 look.py로 찍은 첫 화면부터 이곳에 모입니다. final
          회차를 찍은 프로젝트는 납품 화면으로 표시됩니다.
        </p>
        <a
          className="lp-btn lp-btn-primary"
          href={props.canRequest ? "/dashboard#/request" : "/dashboard"}
        >
          {props.canRequest ? "첫 제작 요청하기" : "대시보드 열기"}
        </a>
      </div>
    );
  else
    body = (
      <div className="lp-cases">
        {data.projects.map((p, i) => (
          <Case key={p.project_id} p={p} index={i} open={viewer.open} />
        ))}
      </div>
    );
  return (
    <section
      id="showcase"
      className="lp-section lp-showcase"
      aria-labelledby="lp-showcase-title"
    >
      <div className="lp-wrap">
        <div className="lp-head lp-head-split">
          <div>
            <h2 id="lp-showcase-title" className="lp-h2">
              브로커가 만든 홈페이지를 만나보세요
              <Spark className="lp-head-spark" />
            </h2>
            <p className="lp-head-sub">
              프로젝트 폴더의 look.py 스크린샷을 그대로 읽어 옵니다. final
              회차가 있으면 납품 화면을, 없으면 가장 최근 회차를 보여 줍니다.
              {data && data.projects.length > 0 && (
                <span className="lp-count num">
                  {" "}
                  납품 {delivered}
                  {making > 0 && ` · 제작 중 ${making}`}
                </span>
              )}
            </p>
          </div>
          <a className="lp-btn lp-btn-sm lp-head-link" href="/dashboard">
            대시보드에서 모두 보기{" "}
            <ArrowRight className="icon icon-sm" aria-hidden />
          </a>
        </div>
        {body}
      </div>
      {viewer.view}
    </section>
  );
}
