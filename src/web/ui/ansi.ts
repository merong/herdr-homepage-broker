// SGR-only ANSI parser for the read-only terminal mirror. `herdr pane read
// --format ansi` prints the rendered screen, so cursor movement does not occur
// in practice; any non-SGR escape is dropped rather than interpreted.
export type Color = { name: string } | { rgb: string };
export interface Span {
  text: string;
  classes: string[];
  fg?: string;
  bg?: string;
}
export type Line = Span[];

// 16-colour slots map to DS terminal tokens; black/white become dim/strong so
// they stay legible on the always-dark terminal surface.
const basic = ["dim", "red", "green", "yellow", "blue", "magenta", "cyan", ""];
const bright = [
  "dim",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "strong",
];
const cube = [0, 95, 135, 175, 215, 255];

function indexed(n: number): Color | undefined {
  if (n < 8) return basic[n] ? { name: basic[n] } : undefined;
  if (n < 16) return { name: bright[n - 8] };
  if (n < 232) {
    const v = n - 16;
    return {
      rgb: `rgb(${cube[Math.floor(v / 36)]},${cube[Math.floor(v / 6) % 6]},${cube[v % 6]})`,
    };
  }
  if (n < 256) {
    const g = 8 + 10 * (n - 232);
    return { rgb: `rgb(${g},${g},${g})` };
  }
  return undefined;
}

interface State {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  fg?: Color;
  bg?: Color;
}
const fresh = (): State => ({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
});

const clamp = (v: number) => Math.max(0, Math.min(255, v | 0));

// Reads an extended colour (38/48/58) starting at codes[i]; returns the colour
// and how many codes it consumed.
function extended(codes: number[], i: number): [Color | undefined, number] {
  if (codes[i + 1] === 5) return [indexed(codes[i + 2] ?? -1), 3];
  if (codes[i + 1] === 2) {
    const [r, g, b] = codes.slice(i + 2, i + 5).map(clamp);
    return [{ rgb: `rgb(${r},${g},${b})` }, 5];
  }
  return [undefined, 1];
}

function sgr(state: State, params: string) {
  // Colon sub-parameters (38:2::r:g:b) carry an optional colour-space slot.
  const codes: number[] = [];
  for (const part of params === "" ? ["0"] : params.split(";")) {
    if (part.includes(":")) {
      const sub = part.split(":").map((x) => (x === "" ? 0 : Number(x)));
      if (sub[1] === 2 && sub.length >= 6)
        codes.push(sub[0], 2, ...sub.slice(-3));
      else codes.push(...sub);
    } else codes.push(part === "" ? 0 : Number(part));
  }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0)
      Object.assign(state, fresh(), { fg: undefined, bg: undefined });
    else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 3) state.italic = true;
    else if (c === 4) state.underline = true;
    else if (c === 7) state.inverse = true;
    else if (c === 22) state.bold = state.dim = false;
    else if (c === 23) state.italic = false;
    else if (c === 24) state.underline = false;
    else if (c === 27) state.inverse = false;
    else if (c >= 30 && c <= 37) state.fg = indexed(c - 30);
    else if (c >= 90 && c <= 97) state.fg = indexed(c - 90 + 8);
    else if (c === 39) state.fg = undefined;
    else if (c >= 40 && c <= 47)
      state.bg = indexed(c - 40) ?? { name: "strong" };
    else if (c >= 100 && c <= 107) state.bg = indexed(c - 100 + 8);
    else if (c === 49) state.bg = undefined;
    else if (c === 38 || c === 48 || c === 58) {
      const [color, used] = extended(codes, i);
      if (c === 38) state.fg = color;
      if (c === 48) state.bg = color;
      i += used - 1;
    }
  }
}

function styled(state: State, text: string): Span {
  let fg = state.fg,
    bg = state.bg;
  const classes: string[] = [];
  if (state.inverse) {
    [fg, bg] = [bg, fg];
    if (!fg && !bg) classes.push("t-inverse");
  }
  const span: Span = { text, classes };
  if (fg && "name" in fg) classes.push(`t-${fg.name}`);
  else if (fg) span.fg = fg.rgb;
  if (bg && "name" in bg) classes.push(`b-${bg.name}`);
  else if (bg) span.bg = bg.rgb;
  if (state.bold) classes.push("t-strong");
  if (state.dim) classes.push("t-dim");
  if (state.italic) classes.push("t-italic");
  if (state.underline) classes.push("t-underline");
  return span;
}

const same = (a: Span, b: Span) =>
  a.fg === b.fg && a.bg === b.bg && a.classes.join(" ") === b.classes.join(" ");

const token =
  /\x1b\[([0-9;:?<=>]*)([ -\/]*[@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[P^_][^\x1b]*(?:\x1b\\)?|\x1b[ -\/]*[0-~]|\n|[\x00-\x08\x0b-\x1f\x7f]/g;

export function parseAnsi(input: string): Line[] {
  const lines: Line[] = [[]];
  const state = fresh();
  const push = (text: string) => {
    if (!text) return;
    const line = lines[lines.length - 1];
    const span = styled(state, text);
    const last = line[line.length - 1];
    if (last && same(last, span)) last.text += text;
    else line.push(span);
  };
  let at = 0;
  for (const m of input.matchAll(token)) {
    push(input.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[0] === "\n") lines.push([]);
    else if (m[2] === "m") sgr(state, m[1]);
  }
  push(input.slice(at));
  // The visible screen pads with blank rows below the prompt; drop them.
  while (
    lines.length > 1 &&
    lines[lines.length - 1].every((s) => !s.text.trim())
  )
    lines.pop();
  return lines;
}
