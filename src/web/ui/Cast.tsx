import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

// The landing's characters. Each one is its own object: a body, a tone, the
// prop it holds and the motion that prop makes. The four shape buddies are the
// SITEON sample characters the team avatars came from. The visor bots are the
// sample's robots: four draw the PM's work stages, and two are the SEO and
// security subagents the PM calls in build-out. Colors come from the theme-invariant terminal tokens
// (landing.css `[data-tone]`), so a character looks the same in both themes.
// All motion lives in landing.css under prefers-reduced-motion: no-preference.

export type CastId =
  | "concept"
  | "broker"
  | "pm"
  | "image"
  | "direction"
  | "first-screen"
  | "look"
  | "build-out"
  | "seo"
  | "security";

export type Tone =
  | "coral"
  | "yellow"
  | "sage"
  | "violet"
  | "blue"
  | "sky"
  | "cobalt";

type Shape = "pill" | "square" | "circle" | "triangle";
type Prop =
  | "bubble"
  | "clipboard"
  | "hardhat"
  | "camera"
  | "brush"
  | "pencil"
  | "magnifier"
  | "rocket"
  | "chart"
  | "shield";

interface Member {
  name: string;
  body: Shape | "bot";
  tone: Tone;
  prop: Prop;
}

export const CAST: Record<CastId, Member> = {
  concept: {
    name: "상담 에이전트",
    body: "pill",
    tone: "violet",
    prop: "bubble",
  },
  broker: { name: "브로커", body: "square", tone: "sage", prop: "clipboard" },
  pm: { name: "Claude PM", body: "circle", tone: "coral", prop: "hardhat" },
  image: {
    name: "이미지 서브에이전트",
    body: "triangle",
    tone: "yellow",
    prop: "camera",
  },
  direction: {
    name: "방향 잡기",
    body: "bot",
    tone: "coral",
    prop: "brush",
  },
  "first-screen": {
    name: "첫 화면",
    body: "bot",
    tone: "yellow",
    prop: "pencil",
  },
  look: {
    name: "화면 검수",
    body: "bot",
    tone: "sage",
    prop: "magnifier",
  },
  "build-out": {
    name: "전체 페이지",
    body: "bot",
    tone: "violet",
    prop: "rocket",
  },
  seo: { name: "SEO 에이전트", body: "bot", tone: "sky", prop: "chart" },
  security: {
    name: "보안 에이전트",
    body: "bot",
    tone: "cobalt",
    prop: "shield",
  },
};

// One observer for every character: off-screen ones pause their loops.
const watchers = new Map<Element, (on: boolean) => void>();
let observer: IntersectionObserver | null = null;

export function useInView(ref: RefObject<Element | null>) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) watchers.get(e.target)?.(e.isIntersecting);
      },
      { rootMargin: "120px" },
    );
    watchers.set(el, setOn);
    observer.observe(el);
    return () => {
      observer?.unobserve(el);
      watchers.delete(el);
    };
  }, [ref]);
  return on;
}

export function Character(props: {
  id: CastId;
  mood?: "happy";
  active?: boolean;
  // Seconds of offset so a row of characters does not move in lockstep.
  delay?: number;
  label?: boolean;
  className?: string;
}) {
  const c = CAST[props.id];
  const uid = "cast" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref);
  const style = props.delay
    ? ({ "--cast-delay": `${props.delay}s` } as CSSProperties)
    : undefined;
  return (
    <svg
      ref={ref}
      className={`cast${props.className ? ` ${props.className}` : ""}`}
      data-cast={props.id}
      data-body={c.body}
      data-tone={c.tone}
      data-mood={props.mood}
      data-active={props.active ? "" : undefined}
      data-off={seen ? undefined : ""}
      viewBox={c.body === "bot" ? "0 0 120 120" : "-10 -12 120 120"}
      role={props.label ? "img" : undefined}
      aria-label={props.label ? c.name : undefined}
      aria-hidden={props.label ? undefined : true}
      focusable="false"
      style={style}
    >
      <defs>
        <radialGradient id={`${uid}-b`} cx="35%" cy="26%" r="82%">
          <stop offset="0%" className="cast-stop-hi" />
          <stop offset="30%" className="cast-stop-base" />
          <stop offset="100%" className="cast-stop-shade" />
        </radialGradient>
      </defs>
      {c.body === "bot" ? (
        <Bot c={c} uid={uid} happy={props.mood === "happy"} />
      ) : (
        <Buddy
          shape={c.body}
          prop={c.prop}
          uid={uid}
          happy={props.mood === "happy"}
        />
      )}
    </svg>
  );
}

// ---- shape buddies (SITEON sample geometry, 100-unit box) ----

const buddyArms: Record<Shape, { still: string; wave: string }> = {
  circle: { still: "M18 60 Q8 64 9 74", wave: "M82 60 Q93 56 94 46" },
  square: { still: "M82 62 Q91 68 86 76", wave: "M18 58 Q7 54 6 44" },
  triangle: { still: "M80 66 Q86 70 84 74", wave: "M22 62 Q11 58 9 48" },
  pill: { still: "M28 58 Q16 62 16 72", wave: "M72 56 Q84 50 85 40" },
};

function Buddy(props: {
  shape: Shape;
  prop: Prop;
  uid: string;
  happy: boolean;
}) {
  const { shape } = props;
  const fill = `url(#${props.uid}-b)`;
  const eyeY = shape === "triangle" ? 62 : shape === "pill" ? 42 : 48;
  const dx = shape === "pill" ? 11 : 13;
  const arms = buddyArms[shape];
  return (
    <>
      <ellipse className="cast-shadow" cx="50" cy="95" rx="26" ry="3.5" />
      <g className="cast-float">
        <path className="cast-limb" d={arms.still} />
        {shape === "circle" && <circle cx="50" cy="54" r="36" fill={fill} />}
        {shape === "square" && (
          <rect x="15" y="20" width="70" height="70" rx="20" fill={fill} />
        )}
        {shape === "triangle" && (
          <polygon
            className="cast-tri"
            points="50,14 88,84 12,84"
            fill={fill}
          />
        )}
        {shape === "pill" && (
          <rect x="26" y="8" width="48" height="84" rx="24" fill={fill} />
        )}
        {props.happy ? (
          <g className="cast-eyes-happy">
            <path
              d={`M${45 - dx} ${eyeY + 2} Q${50 - dx} ${eyeY - 6} ${55 - dx} ${eyeY + 2}`}
            />
            <path
              d={`M${45 + dx} ${eyeY + 2} Q${50 + dx} ${eyeY - 6} ${55 + dx} ${eyeY + 2}`}
            />
          </g>
        ) : (
          <g className="cast-eyes">
            <ellipse
              className="cast-eye"
              cx={50 - dx}
              cy={eyeY}
              rx="5.6"
              ry="7"
            />
            <ellipse
              className="cast-eye"
              cx={50 + dx}
              cy={eyeY}
              rx="5.6"
              ry="7"
            />
            <g className="cast-pupils">
              <circle cx={51.2 - dx} cy={eyeY + 1} r="3.2" />
              <circle cx={51.2 + dx} cy={eyeY + 1} r="3.2" />
            </g>
          </g>
        )}
        <ellipse
          className="cast-blush"
          cx={44 - dx}
          cy={eyeY + 11}
          rx="4.5"
          ry="2.6"
        />
        <ellipse
          className="cast-blush"
          cx={56 + dx}
          cy={eyeY + 11}
          rx="4.5"
          ry="2.6"
        />
        <path
          className="cast-mouth"
          d={
            props.happy
              ? `M45 ${eyeY + 10} Q50 ${eyeY + 17} 55 ${eyeY + 10}`
              : `M46 ${eyeY + 11} Q50 ${eyeY + 15} 54 ${eyeY + 11}`
          }
        />
        {props.prop === "clipboard" && <Clipboard />}
        {props.prop === "camera" && <Camera />}
        {props.prop === "hardhat" && <HardHat />}
        <g className="cast-wave">
          <path className="cast-limb" d={arms.wave} />
          {props.prop === "bubble" && <Bubble />}
          {props.prop === "hardhat" && <SmallPencil />}
        </g>
      </g>
    </>
  );
}

function Bubble() {
  return (
    <g className="cast-bubble">
      <rect
        className="cast-paper"
        x="80"
        y="10"
        width="29"
        height="20"
        rx="8"
      />
      <path className="cast-paper" d="M86 29 L83 36 L92 29 Z" />
      <g className="cast-dots">
        <circle cx="88.5" cy="20" r="2.1" />
        <circle cx="94.5" cy="20" r="2.1" />
        <circle cx="100.5" cy="20" r="2.1" />
      </g>
    </g>
  );
}

function Clipboard() {
  return (
    <g transform="rotate(8 76 78)">
      <rect className="cast-wood" x="63" y="62" width="26" height="32" rx="4" />
      <rect
        className="cast-paper"
        x="66"
        y="67"
        width="20"
        height="24"
        rx="2"
      />
      <rect className="cast-metal" x="70" y="59" width="12" height="6" rx="2" />
      <g className="cast-checks">
        <path d="M68.5 72.5 l2.4 2.4 l4.2 -4.4" />
        <path d="M68.5 79.5 l2.4 2.4 l4.2 -4.4" />
        <path d="M68.5 86.5 l2.4 2.4 l4.2 -4.4" />
      </g>
      <path className="cast-lines" d="M78 72 h5 M78 79 h5 M78 86 h4" />
      <circle className="cast-hand" cx="86" cy="76" r="3.4" />
    </g>
  );
}

function HardHat() {
  return (
    <g className="cast-hat">
      <path
        className="cast-paper"
        d="M24 31 C24 13 36 5 50 5 C64 5 76 13 76 31 Z"
      />
      <rect className="cast-ridge" x="46" y="5" width="8" height="26" rx="3" />
      <rect
        className="cast-brim"
        x="18"
        y="28"
        width="64"
        height="7"
        rx="3.5"
      />
    </g>
  );
}

function SmallPencil() {
  return (
    <g className="cast-prop">
      <g transform="translate(94 46) rotate(22)">
        <rect
          className="cast-pencil"
          x="-2.6"
          y="-22"
          width="5.2"
          height="22"
        />
        <polygon className="cast-wood-light" points="-2.6,-22 2.6,-22 0,-29" />
        <polygon className="cast-ink" points="-1,-26.5 1,-26.5 0,-29" />
        <rect className="cast-eraser" x="-2.6" y="0" width="5.2" height="4" />
      </g>
      <circle className="cast-hand" cx="94" cy="46" r="3.4" />
    </g>
  );
}

function Camera() {
  return (
    <g className="cast-camera">
      <g className="cast-photo">
        <rect
          className="cast-paper"
          x="73"
          y="72"
          width="19"
          height="15"
          rx="1.5"
        />
        <rect className="cast-photo-sky" x="75" y="74" width="15" height="9" />
        <path
          className="cast-photo-hill"
          d="M75 83 L80 78 L84 81 L87 77 L90 83 Z"
        />
      </g>
      <rect
        className="cast-paper"
        x="68"
        y="58"
        width="29"
        height="21"
        rx="5"
      />
      <rect className="cast-band" x="68" y="58" width="29" height="7" rx="3" />
      <circle className="cast-ink" cx="82.5" cy="69.5" r="6.4" />
      <circle className="cast-lens" cx="82.5" cy="69.5" r="3" />
      <rect
        className="cast-flashbulb"
        x="88.5"
        y="60"
        width="5"
        height="3"
        rx="1"
      />
      <g className="cast-flash">
        <path d="M91 52 v-5 M96 54 l4 -3 M98 59 h5" />
      </g>
      <circle className="cast-hand" cx="69" cy="72" r="3.4" />
    </g>
  );
}

// ---- visor bots (the sample's robots, 120-unit box) ----
// Every bot shares one body, measured off the SITEON sample: a tall rounded
// body turned a little to its left, a wide visor with two glowing eyes, stubby
// mitten arms, two feet and a flat white mark on the belly. The prop, the mark
// and the arm pose are what tell the bots apart.

const BOT_BODY =
  "M50 6 C73 6 88.6 23 89 51 C89.4 82 77 98 50 98 C23 98 10.6 82 11 51 C11.4 23 27 6 50 6 Z";
// The visor is a little wider at the top, like an old TV, and sits right of
// centre because the body is turned.
const VISOR =
  "M42.4 16 H66.2 C76.6 16 82.6 22 82.2 31 L81.8 37 C81.2 46.4 75 52 65.4 52 H43.2 C33.6 52 27.4 46.4 26.8 37 L26.4 31 C26 22 32 16 42.4 16 Z";
const BEZEL =
  "M42.4 14.6 H66.2 C77.4 14.6 84 21.2 83.6 31 L83.2 37.2 C82.6 47.4 75.8 53.4 65.4 53.4 H43.2 C32.8 53.4 26 47.4 25.4 37.2 L25 31 C24.6 21.2 31.2 14.6 42.4 14.6 Z";

type BotProp = "brush" | "pencil" | "magnifier" | "rocket" | "chart" | "shield";

interface Pose {
  // The free arm on the bot's right (our left): hanging, or a fist at the chest.
  arm: "nub" | "mitten";
  // The rocket bot waves with the hand that holds nothing.
  raise?: boolean;
  // Where the holding hand sits; the prop swings around it.
  grip: [number, number];
}

const poses: Record<BotProp, Pose> = {
  brush: { arm: "nub", grip: [94, 68] },
  pencil: { arm: "mitten", grip: [90.6, 70] },
  magnifier: { arm: "mitten", grip: [89.6, 72] },
  rocket: { arm: "mitten", raise: true, grip: [83, 68] },
  chart: { arm: "mitten", grip: [89, 75] },
  shield: { arm: "mitten", grip: [89, 73] },
};

function Bot(props: { c: Member; uid: string; happy: boolean }) {
  const { c, uid } = props;
  const prop = c.prop as BotProp;
  const pose = poses[prop];
  const skin = `url(#${uid}-k)`;
  const glow = `url(#${uid}-g)`;
  const core = `url(#${uid}-e)`;
  const [gx, gy] = pose.grip;
  return (
    <>
      <defs>
        <radialGradient id={`${uid}-k`} cx="36%" cy="16%" r="100%">
          <stop offset="0%" className="cast-stop-hi" />
          <stop offset="36%" className="cast-stop-base" />
          <stop offset="82%" className="cast-stop-mid" />
          <stop offset="100%" className="cast-stop-shade" />
        </radialGradient>
        <linearGradient id={`${uid}-o`} x1="0.3" y1="0.25" x2="0.7" y2="1">
          <stop offset="55%" className="cast-stop-ao" stopOpacity="0" />
          <stop offset="100%" className="cast-stop-ao" stopOpacity="0.3" />
        </linearGradient>
        {/* One light for a whole arm, so the fist and thumb read as one. */}
        <radialGradient
          id={`${uid}-a`}
          gradientUnits="userSpaceOnUse"
          cx="12"
          cy="58"
          r="22"
        >
          <stop offset="0%" className="cast-stop-hi" />
          <stop offset="46%" className="cast-stop-base" />
          <stop offset="100%" className="cast-stop-mid" />
        </radialGradient>
        <linearGradient id={`${uid}-v`} x1="0.2" y1="0" x2="0.4" y2="1">
          <stop offset="0%" className="cast-stop-visor" />
          <stop offset="24%" className="cast-stop-ink" />
          <stop offset="84%" className="cast-stop-ink" />
          <stop offset="100%" className="cast-stop-tint" />
        </linearGradient>
        <radialGradient id={`${uid}-g`}>
          <stop offset="0%" className="cast-stop-glow" />
          <stop offset="50%" className="cast-stop-glow" stopOpacity="0.45" />
          <stop offset="100%" className="cast-stop-glow" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-e`} cx="44%" cy="38%" r="66%">
          <stop offset="0%" className="cast-stop-core" />
          <stop offset="78%" className="cast-stop-core" />
          <stop offset="100%" className="cast-stop-glow" />
        </radialGradient>
      </defs>
      <ellipse className="cast-shadow" cx="51" cy="106.4" rx="36" ry="4" />
      <g className="cast-float">
        {pose.raise && (
          <g className="cast-raise">
            <ellipse
              fill={skin}
              cx="85"
              cy="27"
              rx="9.4"
              ry="15"
              transform="rotate(14 85 27)"
            />
          </g>
        )}
        <ellipse fill={skin} cx="34" cy="97" rx="11.6" ry="6.4" />
        <ellipse fill={skin} cx="69" cy="97.4" rx="11.6" ry="6.4" />
        <path fill={skin} d={BOT_BODY} />
        <path fill={`url(#${uid}-o)`} d={BOT_BODY} />
        <path className="cast-rim" d="M86 40 C89.4 54 88.6 72 82 86" />
        <g>
          <path className="cast-bezel" d={BEZEL} />
          <path fill={`url(#${uid}-v)`} d={VISOR} />
          <path className="cast-visor-gloss" d="M31.6 31 Q32.6 22.6 41 20.6" />
          {props.happy ? (
            <g className="cast-bot-happy">
              <path className="cast-arc-glow" d="M38.6 38 Q44.3 29.6 50 38" />
              <path className="cast-arc-glow" d="M60.8 38 Q66.5 29.6 72.2 38" />
              <path className="cast-arc" d="M38.6 38 Q44.3 29.6 50 38" />
              <path className="cast-arc" d="M60.8 38 Q66.5 29.6 72.2 38" />
            </g>
          ) : (
            <g className="cast-eyes">
              <ellipse fill={glow} cx="44.3" cy="35.2" rx="7.4" ry="8.6" />
              <ellipse fill={glow} cx="66.5" cy="35.2" rx="7.4" ry="8.6" />
              <ellipse fill={core} cx="44.3" cy="35.2" rx="4.2" ry="5.1" />
              <ellipse fill={core} cx="66.5" cy="35.2" rx="4.2" ry="5.1" />
            </g>
          )}
        </g>
        <g transform="translate(-3 -5.6)">{marks[prop]}</g>
        {pose.arm === "nub" ? (
          <ellipse
            fill={`url(#${uid}-a)`}
            cx="12"
            cy="67"
            rx="9"
            ry="13.4"
            transform="rotate(20 12 67)"
          />
        ) : (
          <g fill={`url(#${uid}-a)`} transform="matrix(0.86 0 0 0.86 2 4.7)">
            <path d="M28 66.4 C23.4 62 12 62.6 7.4 68.6 C3.2 74.2 5 82.6 12 85.2 C18.4 87.6 26.2 85.2 29 80 C31.2 75.8 30.8 69.2 28 66.4 Z" />
            <path d="M18.6 66 C19.4 61.4 25 59.6 28.4 62.6 C31 65 30.2 69.4 26.8 70.4 C23.6 71.2 18.2 69.4 18.6 66 Z" />
            <path className="cast-crease" d="M19.6 69.2 Q23.4 71.4 27.2 70.2" />
          </g>
        )}
        {!pose.raise && <circle fill={skin} cx={gx} cy={gy} r="6.6" />}
        <g
          className="cast-prop"
          data-prop={prop}
          style={{ "--grip": `${gx}px ${gy}px` } as CSSProperties}
        >
          {botProps[prop]}
        </g>
      </g>
    </>
  );
}

// The flat white marks on the belly, about 20 units across.
const marks: Record<BotProp, ReactNode> = {
  brush: (
    <g className="cast-mark">
      <path d="M62.6 68.4 C70 68.4 73.6 72.8 73.6 77.2 C73.6 80.4 71.2 81.8 69 81.8 L67 81.8 C65.4 81.8 64.8 83.4 65.7 84.6 C66.8 86 65.8 87.8 63.6 87.8 C56.6 87.8 51.4 83.4 51.4 78 C51.4 72.6 56.2 68.4 62.6 68.4 Z" />
      <circle className="cast-mark-hole" cx="57.4" cy="76.6" r="1.8" />
      <circle className="cast-mark-hole" cx="61.4" cy="72.6" r="1.8" />
      <circle className="cast-mark-hole" cx="66.8" cy="73.4" r="1.8" />
    </g>
  ),
  pencil: (
    <g
      className="cast-mark cast-mark-paper"
      transform="matrix(1.22 0 0 1.22 -13.6 -17.2)"
    >
      <path d="M55 70 C55 69 55.8 68.2 56.8 68.2 L65.4 68.2 L71 73.8 L71 86.2 C71 87.2 70.2 88 69.2 88 L56.8 88 C55.8 88 55 87.2 55 86.2 Z" />
      <path
        className="cast-mark-fold"
        d="M65.4 68.2 L65.4 72.4 C65.4 73.2 66 73.8 66.8 73.8 L71 73.8 Z"
      />
      <path
        className="cast-mark-lines"
        d="M58.4 76 H64.6 M58.4 79.6 H67.6 M58.4 83.2 H66"
      />
    </g>
  ),
  magnifier: (
    <g className="cast-mark cast-mark-stroke">
      <circle cx="59.6" cy="75.6" r="8.4" />
      <path d="M65.8 81.8 L71.6 87.6" />
    </g>
  ),
  rocket: (
    <g className="cast-smoke">
      <circle cx="61" cy="79.4" r="6.4" />
      <circle cx="68.2" cy="75.6" r="7.2" />
      <circle cx="74.6" cy="81.6" r="5.8" />
      <circle cx="67" cy="84.6" r="5.6" />
    </g>
  ),
  chart: (
    <g className="cast-mark cast-mark-stroke cast-mark-thin">
      <circle cx="62" cy="78" r="8.6" />
      <ellipse cx="62" cy="78" rx="3.6" ry="8.6" />
      <path d="M53.6 75.4 H70.4 M53.6 80.6 H70.4" />
    </g>
  ),
  shield: (
    <g className="cast-mark">
      <path
        className="cast-mark-stroke"
        d="M57.6 76 V72.6 A4.4 4.4 0 0 1 66.4 72.6 V76"
      />
      <rect x="54.4" y="75.4" width="15.2" height="12" rx="2.8" />
      <circle className="cast-mark-hole" cx="62" cy="80.4" r="1.7" />
      <path className="cast-mark-slot" d="M62 81 V84" />
    </g>
  ),
};

const botProps: Record<BotProp, ReactNode> = {
  brush: (
    <g transform="translate(85.5 85) rotate(19) scale(0.96)">
      <rect
        className="cast-wood"
        x="-5"
        y="-36"
        width="10"
        height="37"
        rx="5"
      />
      <rect
        className="cast-wood-hi"
        x="-3"
        y="-33"
        width="1.8"
        height="30"
        rx="0.9"
      />
      <rect
        className="cast-ferrule"
        x="-6"
        y="-45"
        width="12"
        height="11"
        rx="2.4"
      />
      <ellipse className="cast-bristle" cx="0" cy="-54" rx="14" ry="14.4" />
      <g transform="translate(0 -54) scale(1.3) translate(0 40.6)">
        <path
          className="cast-paint"
          d="M-10.4 -41.6 C-10.6 -48.4 -6.4 -53.2 -1.4 -56 C1.2 -57.6 2.8 -60.2 3.2 -63.4 C7.6 -59.4 10.6 -52.4 10.4 -44.4 C10.3 -41.8 8.8 -41 7.8 -42.8 C7.1 -44 5.8 -44 5.4 -42.4 C4.8 -40 2.6 -39.6 2 -41.8 C1.5 -43.8 -0.3 -44 -1 -42.2 C-1.7 -40.4 -3.6 -39.8 -4.4 -41.6 C-5.2 -43.4 -7.2 -43.6 -8 -41.8 C-8.6 -40.6 -10.2 -40.2 -10.4 -41.6 Z"
        />
        <path className="cast-paint-hi" d="M-5.6 -49.4 Q-3.6 -53 0 -55" />
      </g>
    </g>
  ),
  pencil: (
    <g transform="translate(80 69) rotate(33) scale(0.92)">
      <rect
        className="cast-pencil-hi"
        x="-6.4"
        y="-34"
        width="4.2"
        height="38"
      />
      <rect className="cast-pencil" x="-2.2" y="-34" width="4.4" height="38" />
      <rect
        className="cast-pencil-lo"
        x="2.2"
        y="-34"
        width="4.2"
        height="38"
      />
      <path
        className="cast-pencil-wood"
        d="M-6.4 -34 L6.4 -34 L1.2 -44.6 Q0 -45.8 -1.2 -44.6 Z"
      />
      <path
        className="cast-ink"
        d="M-2.4 -41.4 L2.4 -41.4 L0.8 -45 Q0 -46 -0.8 -45 Z"
      />
      <rect
        className="cast-pencil-wood"
        x="-6.4"
        y="4"
        width="12.8"
        height="3.6"
      />
      <path
        className="cast-ink"
        d="M-6.4 7.6 L6.4 7.6 L2 13.2 Q0 14.6 -2 13.2 Z"
      />
    </g>
  ),
  magnifier: (
    <g transform="translate(83.6 81.6) rotate(18)">
      <rect
        className="cast-handle"
        x="-2.7"
        y="-19"
        width="5.4"
        height="20"
        rx="2.7"
      />
      <rect
        className="cast-handle"
        x="-3.6"
        y="-22.6"
        width="7.2"
        height="5.2"
        rx="2"
      />
      <circle className="cast-glass" cx="0" cy="-37.4" r="13.8" />
      <path className="cast-glint" d="M-8.6 -40.8 Q-7 -47.2 -1.2 -48.4" />
    </g>
  ),
  rocket: (
    <g transform="translate(90.6 53) rotate(37) scale(1.24)">
      <g className="cast-flame">
        <path className="cast-flame-out" d="M-4.6 19 Q0 34 4.6 19 Z" />
        <path className="cast-flame-in" d="M-2.4 19 Q0 27 2.4 19 Z" />
      </g>
      <path
        className="cast-fin"
        d="M-6.6 4 L-13.4 16.6 Q-13.6 19.6 -10.8 18.8 L-6 16 Z"
      />
      <path
        className="cast-fin"
        d="M6.6 4 L13.4 16.6 Q13.6 19.6 10.8 18.8 L6 16 Z"
      />
      <path
        className="cast-rocket"
        d="M0 -26 C8.4 -17 9.4 2 7.2 18.4 L-7.2 18.4 C-9.4 2 -8.4 -17 0 -26 Z"
      />
      <path
        className="cast-rocket-shade"
        d="M4.6 -15 C7.6 -6 8 6 6.4 18.4 L3.6 18.4 C5 6 4.8 -6 4.6 -15 Z"
      />
      <path
        className="cast-fin"
        d="M0 -26 C4.4 -21.4 6.6 -15.6 7.6 -10 L-7.6 -10 C-6.6 -15.6 -4.4 -21.4 0 -26 Z"
      />
      <circle className="cast-fin" cx="0" cy="0" r="5" />
      <circle className="cast-window" cx="0" cy="0" r="3.4" />
      <circle className="cast-window-glint" cx="-1.2" cy="-1.2" r="1" />
      <rect
        className="cast-fin"
        x="-5.4"
        y="17.4"
        width="10.8"
        height="3.2"
        rx="1.2"
      />
    </g>
  ),
  chart: (
    <g transform="translate(90 75) rotate(10) scale(1.14)">
      <rect
        className="cast-wood"
        x="-1.8"
        y="-21"
        width="3.6"
        height="24"
        rx="1.8"
      />
      <rect
        className="cast-board"
        x="-6"
        y="-45"
        width="30"
        height="25"
        rx="4.6"
      />
      <g className="cast-bars">
        <rect
          className="cast-bar-1"
          x="-1.6"
          y="-30.6"
          width="5"
          height="6.6"
          rx="1.2"
        />
        <rect
          className="cast-bar-2"
          x="5.4"
          y="-34.6"
          width="5"
          height="10.6"
          rx="1.2"
        />
        <rect
          className="cast-bar-3"
          x="12.4"
          y="-39.6"
          width="5"
          height="15.6"
          rx="1.2"
        />
      </g>
      <path
        className="cast-arrow"
        d="M-2 -34.8 L4.6 -38.6 L10 -36.8 L17.6 -42"
      />
      <path className="cast-arrow" d="M13.8 -42.4 L17.8 -42.2 L17.4 -38.4" />
    </g>
  ),
  shield: (
    <g transform="translate(94 65) scale(1.18)">
      <path
        className="cast-shield"
        d="M0 -17 C5.4 -13.6 10.4 -13 14 -13.4 C14.4 1.4 9.6 11.4 0 17 C-9.6 11.4 -14.4 1.4 -14 -13.4 C-10.4 -13 -5.4 -13.6 0 -17 Z"
      />
      <path
        className="cast-shield-face"
        d="M0 -13 C4.2 -10.4 8 -9.8 10.6 -10.1 C10.8 1 7.2 8.6 0 12.9 C-7.2 8.6 -10.8 1 -10.6 -10.1 C-8 -9.8 -4.2 -10.4 0 -13 Z"
      />
      <path
        className="cast-shield-shine"
        d="M-6.6 -6.4 C-6.6 0 -4.8 4.6 -1.6 8"
      />
      <path className="cast-shield-check" d="M-5 0.4 L-1.2 4.2 L5.6 -4" />
    </g>
  ),
};

// The little three-stroke spark beside headings, as in the sample.
export function Spark(props: { className?: string }) {
  return (
    <svg
      className={`spark${props.className ? ` ${props.className}` : ""}`}
      viewBox="0 0 32 32"
      aria-hidden
      focusable="false"
    >
      <path d="M7 19 L3 15.5" />
      <path d="M14 13 L12.5 5.5" />
      <path d="M21.5 14.5 L27 9" />
    </svg>
  );
}
