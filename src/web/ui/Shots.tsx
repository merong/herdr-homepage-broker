import { useRef, useState } from "react";
import {
  assetUrl,
  clock,
  hm,
  roundName,
  shotUrl,
  useShots,
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
const latest = (s: Shots | null) => s?.rounds.at(-1);
const pick = (r: Round | undefined, viewport: string, full = false) =>
  r?.files.find((f) => f.viewport === viewport && f.full === full);

// Thumbnails always use the viewport-sized PNG; the full page opens on click.
function Thumb(props: {
  id: string;
  shot: Shot;
  caption?: string;
  onOpen?: (s: Shot) => void;
}) {
  const { shot } = props;
  return (
    <div className="shot">
      <button
        type="button"
        className="shot-img"
        data-device={shot.viewport}
        onClick={() => props.onOpen?.(shot)}
        aria-label={`${shot.viewport} 스크린샷 크게 보기`}
      >
        <img
          src={shotUrl(props.id, shot)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </button>
      {props.caption && (
        <span className="shot-cap">
          <span>{props.caption}</span>
          <span>{hm(shot.mtime)}</span>
        </span>
      )}
    </div>
  );
}

function useLightbox(id: string, round?: (s: Shot) => Round | undefined) {
  const ref = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const open = (s: Shot) => {
    const full = round?.(s)?.files.find(
      (f) => f.viewport === s.viewport && f.full,
    );
    setSrc(shotUrl(id, full ?? s));
    ref.current?.showModal();
  };
  const view = (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label="스크린샷"
      onClick={() => ref.current?.close()}
    >
      <div className="dialog-head">
        <span className="heading">스크린샷</span>
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => ref.current?.close()}
        >
          닫기
        </button>
      </div>
      <div className="dialog-body">{src && <img src={src} alt="" />}</div>
    </dialog>
  );
  return { open, view };
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

export function ShotGallery(props: Props) {
  const { data, error } = useShots(props.projectId, props.revision);
  const roundOf = (s: Shot) => data?.rounds.find((r) => r.files.includes(s));
  const box = useLightbox(props.projectId, roundOf);
  if (!data)
    return (
      <p className="help">
        {error
          ? `스크린샷 목록을 불러오지 못했습니다 (${error}).`
          : "스크린샷을 불러오고 있습니다."}
      </p>
    );
  return (
    <div className="stack">
      {data.rounds.length ? (
        [...data.rounds].reverse().map((r) => (
          <div className="shot-round" key={r.round}>
            <div className="shot-round-head">
              <b>{roundName(r.round)}</b>
              <span className="badge">{stageNames[r.stage] ?? r.stage}</span>
              <span className="muted num">{clock(r.at)}</span>
            </div>
            <div className="shots">
              {r.files
                .filter((f) => !f.full)
                .map((f) => (
                  <Thumb
                    key={f.path}
                    id={props.projectId}
                    shot={f}
                    caption={f.viewport}
                    onOpen={box.open}
                  />
                ))}
            </div>
            {r.verdict && <Verdict text={r.verdict} />}
          </div>
        ))
      ) : (
        <p className="shot-empty">
          아직 스크린샷이 없습니다. PM이 look.py 회차를 마치면
          reports/look/&lt;회차&gt;/ 화면이 여기에 쌓입니다.
        </p>
      )}
      {data.assets.length > 0 && (
        <div>
          <div className="section-head">
            <span>생성 이미지 · {data.assets.length}장</span>
            <span>assets/</span>
          </div>
          <div className="shots">
            {data.assets.map((a) => (
              <div className="shot" key={a.path}>
                <a
                  className="shot-img"
                  href={assetUrl(props.projectId, a)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={assetUrl(props.projectId, a)}
                    alt={a.name}
                    loading="lazy"
                    decoding="async"
                  />
                </a>
                <span className="shot-cap">
                  <span className="mono">{a.name}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {box.view}
    </div>
  );
}

// Latest round on a running project's card: desktop + mobile side by side.
export function ShotStrip(props: Props) {
  const { data } = useShots(props.projectId, props.revision);
  const r = latest(data);
  const roundOf = () => r;
  const box = useLightbox(props.projectId, roundOf);
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
        {desktop && (
          <Thumb id={props.projectId} shot={desktop} onOpen={box.open} />
        )}
        {mobile && (
          <Thumb id={props.projectId} shot={mobile} onOpen={box.open} />
        )}
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

export function ListThumb(props: Props) {
  const { data } = useShots(props.projectId, props.revision);
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
