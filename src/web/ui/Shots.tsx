import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  assetUrl,
  bytes,
  hm,
  roundName,
  shotUrl,
  useShots,
  when,
  type Round,
  type Shot,
  type Shots,
} from "./data";

interface Props {
  projectId: string;
  runId: string;
  revision: number;
}
const stageNames: Record<string, string> = {
  "first-screen": "first-screen",
  "build-out": "build-out",
  final: "납품 증거",
};
const viewportNames: Record<string, string> = {
  desktop: "데스크톱",
  mobile: "모바일",
};
const latest = (s: Shots | null) => s?.rounds.at(-1);
const pick = (r: Round | undefined, viewport: string, full = false) =>
  r?.files.find((f) => f.viewport === viewport && f.full === full);

// Rendered into <body>: the shell re-inserts slot containers on every
// snapshot, and a modal <dialog> that leaves the document loses its top layer.
function Lightbox(props: { src: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={props.title}
      onClose={props.onClose}
      onClick={() => ref.current?.close()}
    >
      <div className="dialog-head">
        <span className="heading">{props.title}</span>
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => ref.current?.close()}
        >
          닫기
        </button>
      </div>
      <div className="dialog-body">
        <img src={props.src} alt={props.title} />
      </div>
    </dialog>
  );
}
function useLightbox() {
  const [shown, setShown] = useState<{ src: string; title: string } | null>(
    null,
  );
  const view =
    shown &&
    createPortal(
      <Lightbox {...shown} onClose={() => setShown(null)} />,
      document.body,
    );
  return {
    open: (src: string, title: string) => setShown({ src, title }),
    view,
  };
}

// One entry per screen: a look round's viewport PNG (its full-page PNG rides
// along and opens on click) or a generated image from assets/.
interface Item {
  key: string;
  name: string;
  tag: string;
  kind: string;
  viewport?: string;
  src: string;
  full?: string;
  fullSize?: number;
  size?: number;
  mtime: string;
}
function shotItem(id: string, r: Round, s: Shot): Item {
  const full = pick(r, s.viewport, true);
  return {
    key: s.path,
    name: s.name,
    tag: `${r.round === "final" ? "최종" : `${r.round}회`} ${s.viewport === "desktop" ? "PC" : "M"}`,
    kind: `look ${roundName(r.round)} · ${stageNames[r.stage] ?? r.stage} · ${viewportNames[s.viewport]}`,
    viewport: s.viewport,
    src: shotUrl(id, s),
    full: full && shotUrl(id, full),
    fullSize: full?.size,
    size: s.size,
    mtime: s.mtime,
  };
}
function collect(id: string, data: Shots) {
  const rounds = [...data.rounds].reverse();
  const groups = rounds.map((r) => ({
    key: r.round,
    title: roundName(r.round),
    badge: stageNames[r.stage] ?? r.stage,
    at: r.at,
    verdict: r.verdict,
    items: r.files.filter((f) => !f.full).map((f) => shotItem(id, r, f)),
  }));
  const images: Item[] = [...data.assets].reverse().map((a) => ({
    key: a.path,
    name: a.name,
    tag: "이미지",
    kind: "생성 이미지 · assets/",
    src: assetUrl(id, a),
    size: a.size,
    mtime: a.mtime,
  }));
  if (images.length)
    groups.push({
      key: "assets",
      title: "생성 이미지",
      badge: "assets/",
      at: data.assets.at(-1)!.mtime,
      verdict: null,
      items: images,
    });
  // The grid leads with the newest final (else the newest round), then the
  // generated images, then the older rounds.
  const [head, ...older] = groups.filter((g) => g.key !== "assets");
  const ordered = [
    ...(head?.items ?? []),
    ...images,
    ...older.flatMap((g) => g.items),
  ];
  return { groups, ordered };
}

export function assetSummary(data: Shots | null) {
  if (!data) return "불러오는 중";
  const shots = data.rounds.reduce(
    (n, r) => n + r.files.filter((f) => !f.full).length,
    0,
  );
  if (!shots && !data.assets.length) return "아직 없음";
  return [
    shots ? `스크린샷 ${shots}장` : "",
    data.assets.length ? `생성 이미지 ${data.assets.length}장` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const GRID = 8;

// Basic view: a thumbnail grid beside the activity list. Past GRID items the
// last tile becomes "+n", which opens the asset section like "전체 보기".
export function AssetGrid(props: Props & { onMore: () => void }) {
  const { data, error } = useShots(props.projectId, props.revision);
  const box = useLightbox();
  if (!data)
    return (
      <p className="help asset-pad">
        {error
          ? `에셋 목록을 불러오지 못했습니다 (${error}).`
          : "에셋을 불러오고 있습니다."}
      </p>
    );
  const { ordered } = collect(props.projectId, data);
  if (!ordered.length)
    return (
      <p className="asset-empty">결과 스크린샷이 생기면 여기에 모입니다</p>
    );
  const shown = ordered.length > GRID ? ordered.slice(0, GRID - 1) : ordered;
  const rest = ordered.length - shown.length;
  return (
    <div className="asset-pad stack">
      <div className="asset-grid">
        {shown.map((it) => (
          <button
            type="button"
            key={it.key}
            className="asset-tile"
            onClick={() =>
              box.open(it.full ?? it.src, `${it.kind} · ${it.name}`)
            }
            aria-label={`${it.kind} 크게 보기`}
            title={it.kind}
          >
            <img src={it.src} alt="" loading="lazy" decoding="async" />
            <span className="asset-tag">{it.tag}</span>
          </button>
        ))}
        {rest > 0 && (
          <button
            type="button"
            className="asset-tile asset-more"
            onClick={props.onMore}
            aria-label={`에셋 ${rest}개 더 보기`}
          >
            +{rest}
          </button>
        )}
      </div>
      <div>
        <button type="button" className="btn-link" onClick={props.onMore}>
          전체 보기
        </button>
      </div>
      {box.view}
    </div>
  );
}

function AssetRow(props: {
  item: Item;
  onOpen: (src: string, title: string) => void;
}) {
  const it = props.item;
  const [res, setRes] = useState<string | null>(null);
  return (
    <li className="asset-row">
      <button
        type="button"
        className="asset-row-thumb"
        data-device={it.viewport}
        onClick={() => props.onOpen(it.src, `${it.kind} · ${it.name}`)}
        aria-label={`${it.kind} 크게 보기`}
      >
        <img
          src={it.src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) =>
            setRes(
              `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`,
            )
          }
        />
      </button>
      <span className="asset-row-main">
        <span className="asset-row-name mono">{it.name}</span>
        <span className="asset-row-kind">{it.kind}</span>
      </span>
      <span className="asset-row-meta num">
        <span>{when(it.mtime)}</span>
        <span>{[res, bytes(it.size)].filter(Boolean).join(" · ") || "—"}</span>
        {it.full && (
          <button
            type="button"
            className="btn-link"
            onClick={() => props.onOpen(it.full!, `${it.kind} · 전체 페이지`)}
          >
            전체 페이지{it.fullSize ? ` · ${bytes(it.fullSize)}` : ""}
          </button>
        )}
      </span>
    </li>
  );
}

// verdict.md is short markdown: a "# look N" heading and "- " bullets. The
// heading repeats the round name, so only the bullets and prose are shown.
function Verdict({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const items = lines.filter((l) => /^[-*] /.test(l));
  const prose = lines.filter((l) => !/^[-*] /.test(l));
  return (
    <div className="shot-verdict">
      {prose.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {items.length > 0 && (
        <ul>
          {items.map((l, i) => (
            <li key={i}>{l.slice(2)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Detailed view: every screen listed by round, final first, then the
// generated images, with time, file size and the decoded resolution.
export function AssetList(props: Props) {
  const { data, error } = useShots(props.projectId, props.revision);
  const box = useLightbox();
  if (!data)
    return (
      <p className="help asset-pad">
        {error
          ? `에셋 목록을 불러오지 못했습니다 (${error}).`
          : "에셋을 불러오고 있습니다."}
      </p>
    );
  const { groups } = collect(props.projectId, data);
  if (!groups.length)
    return (
      <p className="asset-empty">
        결과 스크린샷이 생기면 여기에 모입니다. PM이 look.py 회차를 마치면
        reports/look/&lt;회차&gt;/ 화면이 쌓입니다.
      </p>
    );
  return (
    <div className="asset-list">
      {groups.map((g) => (
        <div className="asset-group" key={g.key}>
          <div className="asset-group-head">
            <b>{g.title}</b>
            <span className="badge">{g.badge}</span>
            <span className="muted num">{when(g.at)}</span>
            <span className="grow" />
            <span className="muted num">{g.items.length}장</span>
          </div>
          <ul className="asset-rows">
            {g.items.map((it) => (
              <AssetRow key={it.key} item={it} onOpen={box.open} />
            ))}
          </ul>
          {g.verdict && <Verdict text={g.verdict} />}
        </div>
      ))}
      {box.view}
    </div>
  );
}

function Thumb(props: { id: string; shot: Shot; onOpen: (s: Shot) => void }) {
  const { shot } = props;
  return (
    <div className="shot">
      <button
        type="button"
        className="shot-img"
        data-device={shot.viewport}
        onClick={() => props.onOpen(shot)}
        aria-label={`${viewportNames[shot.viewport]} 스크린샷 크게 보기`}
      >
        <img
          src={shotUrl(props.id, shot)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </button>
    </div>
  );
}

// Latest round on a running project's card: desktop + mobile side by side.
export function ShotStrip(props: Props) {
  const { data } = useShots(props.projectId, props.revision);
  const r = latest(data);
  const box = useLightbox();
  const open = (s: Shot) =>
    box.open(
      shotUrl(props.projectId, pick(r, s.viewport, true) ?? s),
      `${roundName(r!.round)} · ${viewportNames[s.viewport]}`,
    );
  const desktop = pick(r, "desktop"),
    mobile = pick(r, "mobile");
  if (!r || (!desktop && !mobile))
    return (
      <p className="shot-empty">
        {data?.assets.length
          ? `생성 이미지 ${data.assets.length}장 · 첫 스크린샷을 기다립니다.`
          : "look.py 회차가 끝나면 스크린샷이 보입니다."}
      </p>
    );
  return (
    <div className="stack">
      <div className="section-head">
        <span>
          {roundName(r.round)} · {stageNames[r.stage] ?? r.stage}
        </span>
        <span className="num">{hm(r.at)}</span>
      </div>
      <div className="shots">
        {desktop && <Thumb id={props.projectId} shot={desktop} onOpen={open} />}
        {mobile && <Thumb id={props.projectId} shot={mobile} onOpen={open} />}
      </div>
      {box.view}
    </div>
  );
}

// Review card cover: the final round when present, else the latest one.
export function ShotCover(props: Props) {
  const { data } = useShots(props.projectId, props.revision);
  const r = data?.rounds.find((x) => x.round === "final") ?? latest(data);
  const shot = pick(r, "desktop");
  const asset = data?.assets.at(-1);
  return (
    <div className="shot-img">
      {shot ? (
        <img
          src={shotUrl(props.projectId, shot)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : asset ? (
        <img
          src={assetUrl(props.projectId, asset)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </div>
  );
}

// Sidebar thumbnail for projects that are not running: the latest result
// screen (final when present). Idle projects refresh on a new revision only.
export function ListThumb(props: Props & { poll?: boolean }) {
  const { data } = useShots(
    props.projectId,
    props.revision,
    props.poll === false ? 0 : 20000,
  );
  const shot = pick(latest(data), "desktop");
  return shot ? (
    <img
      src={shotUrl(props.projectId, shot)}
      alt=""
      loading="lazy"
      decoding="async"
    />
  ) : null;
}
