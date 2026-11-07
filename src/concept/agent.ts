import { spawn } from "node:child_process";
import { fail } from "../contracts/types.js";
import { findCommand } from "../agents/studio.js";
import { CHAT_PROMPT, COMPOSE_PROMPT } from "./prompt.js";
import {
  COMPOSE_SCHEMA,
  OUTPUT_SCHEMA,
  validCompose,
  validOutput,
  type ComposeOutput,
  type ConceptOutput,
} from "./schema.js";

export const CONCEPT_MODEL = "claude-opus-5-5";
// medium, not the PM's high: one chat turn should answer within seconds.
export const CONCEPT_EFFORT = "medium";

// Test seam (like studio.dir): a fake claude executable and shorter limits.
// A chat turn answers one question; writing both documents takes longer.
export const conceptAgent = {
  bin: null as string | null,
  timeoutMs: 120_000,
  composeTimeoutMs: 240_000,
};

const kinds = {
  chat: {
    schema: OUTPUT_SCHEMA,
    prompt: CHAT_PROMPT,
    valid: validOutput,
    timeout: () => conceptAgent.timeoutMs,
    text: {
      spawn: "에이전트를 실행하지 못했습니다. 다시 보내 보세요.",
      timeout: (s: number) =>
        `에이전트가 ${s}초 안에 답하지 않았습니다. 다시 보내거나 문서 직접 작성을 사용하세요.`,
      failed: "에이전트가 답을 만들지 못했습니다. 다시 보내 보세요.",
      invalid:
        "에이전트의 답이 정해진 형식에 맞지 않아 기록하지 않았습니다. 다시 보내 보세요.",
    },
  },
  compose: {
    schema: COMPOSE_SCHEMA,
    prompt: COMPOSE_PROMPT,
    valid: validCompose,
    timeout: () => conceptAgent.composeTimeoutMs,
    text: {
      spawn: "에이전트를 실행하지 못했습니다. 다시 시도하세요.",
      timeout: (s: number) =>
        `문서를 ${s}초 안에 다 쓰지 못했습니다. 다시 시도하거나 문서 직접 작성을 사용하세요.`,
      failed: "문서를 만들지 못했습니다. 다시 시도하세요.",
      invalid:
        "만든 문서가 정해진 형식에 맞지 않아 저장하지 않았습니다. 다시 시도하세요.",
    },
  },
};
type Kind = keyof typeof kinds;

// Fixed argv only: no tools, no MCP, no user settings or hooks, no saved
// session. The conversation goes to stdin.
export function conceptArgs(kind: Kind = "chat") {
  return [
    "-p",
    "--model",
    CONCEPT_MODEL,
    "--effort",
    CONCEPT_EFFORT,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(kinds[kind].schema),
    "--system-prompt",
    kinds[kind].prompt,
  ];
}

let found: { at: number; bin: string | null } | undefined;
export async function claudeBin() {
  if (conceptAgent.bin) return conceptAgent.bin;
  if (found && Date.now() - found.at < (found.bin ? 600_000 : 30_000))
    return found.bin;
  const bin = (await findCommand("claude")) ?? null;
  found = { at: Date.now(), bin };
  return bin;
}

const missing = (): never =>
  fail(
    "concept_claude_missing",
    "이 컴퓨터에서 claude 명령을 찾지 못해 대화를 시작할 수 없습니다. Claude Code를 설치한 뒤 다시 시도하거나 문서 직접 작성을 사용하세요.",
  );
const login =
  /not logged in|\/login|invalid api key|authenticat|unauthorized|oauth/i;

type RunOptions = { cwd: string; signal?: AbortSignal };

export const runConceptTurn = (input: string, options: RunOptions) =>
  run("chat", input, options) as Promise<ConceptOutput>;
export const runConceptCompose = (input: string, options: RunOptions) =>
  run("compose", input, options) as Promise<ComposeOutput>;

async function run(kind: Kind, input: string, options: RunOptions) {
  const { valid, timeout, text } = kinds[kind];
  const bin = (await claudeBin()) ?? missing();
  // The PM's Herdr pane variables and broker overrides stay out of the child.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:HERDR_|HOMEPAGE_)/.test(key),
    ),
  );
  const result = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    error?: NodeJS.ErrnoException;
  }>((resolve) => {
    const child = spawn(bin, conceptArgs(kind), {
      cwd: options.cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      timedOut = false,
      error: NodeJS.ErrnoException | undefined;
    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout());
    options.signal?.addEventListener("abort", kill, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => {
      stdout += s;
      if (stdout.length > 4 * 1024 * 1024) kill();
    });
    child.stderr.on("data", (s: string) => {
      if (stderr.length < 64 * 1024) stderr += s;
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (e) => (error = e));
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
      resolve({ code, stdout, stderr, timedOut, error });
    });
  });
  if (result.error)
    if (["ENOENT", "EACCES"].includes(result.error.code ?? "")) {
      found = undefined;
      missing();
    } else fail("concept_failed", text.spawn);
  if (result.timedOut)
    fail("concept_timeout", text.timeout(Math.round(timeout() / 1000)));
  let out: any;
  try {
    out = JSON.parse(result.stdout.trim());
  } catch {}
  // Only the code is reported. stderr and the CLI's own text never leave here.
  if (!out || typeof out !== "object" || out.is_error || result.code !== 0) {
    if (login.test(`${out?.result ?? ""}\n${result.stderr}`))
      fail(
        "concept_login_required",
        "claude에 로그인되어 있지 않습니다. 터미널에서 claude를 실행해 로그인한 뒤 다시 시도하거나 문서 직접 작성을 사용하세요.",
      );
    fail("concept_failed", text.failed);
  }
  if (!valid(out.structured_output))
    fail("concept_output_invalid", text.invalid);
  return out.structured_output;
}
