import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fail, now } from "../contracts/types.js";
import { atomic } from "../storage/store.js";
import { claudeBin, runConceptCompose, runConceptTurn } from "./agent.js";
import { GREETING, composeInput, conceptInput } from "./prompt.js";
import type { ConceptDraft } from "./schema.js";

export const MAX_TEXT = 2000;
export const MAX_USER_TURNS = 16;
const MAX_RUNNING = 2;
const KEEP_MS = 14 * 24 * 3600_000;
const KEEP_FILES = 50;

type Message = {
  role: "agent" | "user";
  text: string;
  at: string;
  choices?: string[];
  ms?: number;
  client_message_id?: string;
};
type Documents = {
  project_id: string;
  prd: string;
  design: string;
  at: string;
  // User turns the documents were written from; more turns since = stale.
  user_turns: number;
  ms: number;
  client_request_id: string;
};
type Concept = {
  schema_version: 1;
  concept_id: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  draft: ConceptDraft | null;
  ready: boolean;
  documents?: Documents | null;
};
// One model call per conversation at a time: a chat turn or 문서 만들기.
type Pending = {
  kind: "message" | "documents";
  client_id: string;
  text?: string;
  started_at: string;
  done: Promise<Concept>;
};

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const userTurns = (c: Concept) =>
  c.messages.filter((m) => m.role === "user").length;

function only(input: any, keys: string[], idKey: string) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    fail("invalid_request", `${keys.join("와 ")}만 보낼 수 있습니다.`);
  if (
    typeof input[idKey] !== "string" ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(input[idKey])
  )
    fail("invalid_request", `${idKey} 형식이 올바르지 않습니다.`);
}

// Concept chats live beside the broker state, never in the checkpoint: they
// are drafts until the user sends the documents through init/submit.
export class Concepts {
  private pending = new Map<string, Pending>();
  private controller = new AbortController();
  // `taken(id)`: whether a project directory with that ID already exists
  // (the server checks projectDirectory()); documents get -2, -3… instead.
  constructor(
    private root: string,
    private taken: (id: string) => Promise<boolean> = async () => false,
  ) {}

  private file(id: string) {
    return path.join(this.root, `${id}.json`);
  }

  private async load(id: string): Promise<Concept> {
    if (!validId(id)) fail("unknown_concept", "대화를 찾을 수 없습니다.");
    try {
      const stat = await fs.lstat(this.file(id));
      if (stat.isFile() && stat.size <= 1024 * 1024) {
        const c = JSON.parse(await fs.readFile(this.file(id), "utf8"));
        if (c?.schema_version === 1 && c.concept_id === id) return c;
      }
    } catch {}
    fail(
      "unknown_concept",
      "대화를 찾을 수 없습니다. 처음부터 다시 시작하세요.",
    );
  }

  private async save(c: Concept) {
    await atomic(this.file(c.concept_id), JSON.stringify(c, null, 2), 0o600);
  }

  // Drops chats idle for 14 days and keeps the newest 50 (counting the one
  // about to be created). Chats with a running turn are never removed.
  private async prune() {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.root);
    } catch {
      return;
    }
    const files = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!name.endsWith(".json") || !validId(id) || this.pending.has(id))
        continue;
      try {
        const stat = await fs.lstat(path.join(this.root, name));
        if (stat.isFile()) files.push({ name, at: stat.mtimeMs });
      } catch {}
    }
    files.sort((a, b) => b.at - a.at);
    for (const [i, f] of files.entries())
      if (i >= KEEP_FILES - 1 || Date.now() - f.at > KEEP_MS)
        await fs.rm(path.join(this.root, f.name), { force: true });
  }

  private async view(c: Concept) {
    let p = this.pending.get(c.concept_id);
    // A joined request may read the result before the first one clears it.
    if (
      p &&
      (p.kind === "message"
        ? c.messages.some((m) => m.client_message_id === p!.client_id)
        : c.documents?.client_request_id === p.client_id)
    )
      p = undefined;
    const bin = await claudeBin().catch(() => null);
    const turns = userTurns(c);
    const d = c.documents;
    return {
      concept_id: c.concept_id,
      created_at: c.created_at,
      updated_at: c.updated_at,
      messages: c.messages.map((m) => ({
        role: m.role,
        text: m.text,
        at: m.at,
        ...(m.role === "agent"
          ? { choices: m.choices ?? [], ms: m.ms ?? null }
          : {}),
      })),
      draft: c.draft,
      ready: c.ready,
      user_turns: turns,
      max_user_turns: MAX_USER_TURNS,
      documents: d
        ? {
            project_id: d.project_id,
            prd: d.prd,
            design: d.design,
            at: d.at,
            user_turns: d.user_turns,
          }
        : null,
      documents_stale: !!d && d.user_turns !== turns,
      pending: !p
        ? null
        : p.kind === "message"
          ? {
              kind: p.kind,
              client_message_id: p.client_id,
              text: p.text,
              started_at: p.started_at,
            }
          : {
              kind: p.kind,
              client_request_id: p.client_id,
              started_at: p.started_at,
            },
      agent: bin
        ? { available: true, reason: null }
        : {
            available: false,
            reason: "concept_claude_missing",
            message:
              "이 컴퓨터에서 claude 명령을 찾지 못해 대화로 만들기를 쓸 수 없습니다. 문서 직접 작성을 사용하세요.",
          },
    };
  }

  async create() {
    await this.prune();
    const at = now();
    const c: Concept = {
      schema_version: 1,
      concept_id: randomUUID(),
      created_at: at,
      updated_at: at,
      messages: [{ role: "agent", text: GREETING, at, choices: [] }],
      draft: null,
      ready: false,
      documents: null,
    };
    await this.save(c);
    return this.view(c);
  }

  async get(id: string) {
    return this.view(await this.load(id));
  }

  async send(id: string, input: any) {
    only(input, ["text", "client_message_id"], "client_message_id");
    const { text, client_message_id } = input;
    if (typeof text !== "string" || !text.trim())
      fail("invalid_request", "보낼 내용을 입력하세요.");
    if (text.length > MAX_TEXT)
      fail(
        "invalid_request",
        `한 번에 ${MAX_TEXT}자까지 보낼 수 있습니다. 나눠서 보내 주세요.`,
      );
    const c = await this.load(id);
    // A resent message returns the stored turn instead of a second model call.
    if (c.messages.some((m) => m.client_message_id === client_message_id))
      return this.view(c);
    const joined = this.join(id, "message", client_message_id);
    if (joined) return this.view(await joined);
    const turns = userTurns(c);
    if (turns >= MAX_USER_TURNS)
      fail(
        "concept_turn_limit",
        `대화는 ${MAX_USER_TURNS}번까지 주고받을 수 있습니다. 지금 초안으로 문서를 만들거나 처음부터 다시 시작하세요.`,
      );
    return this.run(c, "message", client_message_id, text, async (work) => {
      const started = Date.now();
      const out = await runConceptTurn(
        conceptInput(
          c.messages,
          c.draft,
          text,
          turns + 1,
          MAX_USER_TURNS,
          !!c.documents,
        ),
        { cwd: work, signal: this.controller.signal },
      );
      const at = now();
      return {
        ...c,
        updated_at: at,
        messages: [
          ...c.messages,
          {
            role: "user",
            text,
            at: new Date(started).toISOString(),
            client_message_id,
          },
          {
            role: "agent",
            text: out.reply,
            at,
            choices: out.choices,
            ms: Date.now() - started,
          },
        ],
        draft: out.draft,
        ready: out.ready,
      };
    });
  }

  // 문서 만들기: writes prd/design from the conversation in a separate call.
  async compose(id: string, input: any) {
    only(input, ["client_request_id"], "client_request_id");
    const { client_request_id } = input;
    const c = await this.load(id);
    if (c.documents?.client_request_id === client_request_id)
      return this.view(c);
    const joined = this.join(id, "documents", client_request_id);
    if (joined) return this.view(await joined);
    if (!c.ready)
      fail(
        "concept_not_ready",
        "아직 문서를 쓸 만큼 정리되지 않았습니다. 질문에 조금 더 답해 주세요.",
      );
    return this.run(
      c,
      "documents",
      client_request_id,
      undefined,
      async (work) => {
        const started = Date.now();
        const out = await runConceptCompose(composeInput(c.messages, c.draft), {
          cwd: work,
          signal: this.controller.signal,
        });
        const at = now();
        return {
          ...c,
          updated_at: at,
          documents: {
            project_id: await this.freeId(out.project_id),
            prd: out.prd,
            design: out.design,
            at,
            user_turns: userTurns(c),
            ms: Date.now() - started,
            client_request_id,
          },
        };
      },
    );
  }

  // The same request again waits for the running call; anything else is busy.
  private join(id: string, kind: Pending["kind"], clientId: string) {
    const running = this.pending.get(id);
    if (!running) return undefined;
    if (running.kind === kind && running.client_id === clientId)
      return running.done;
    fail(
      "concept_busy",
      running.kind === "documents"
        ? "문서를 쓰는 중입니다. 다 쓴 뒤에 다시 해 주세요."
        : "에이전트가 앞 메시지에 답하는 중입니다. 답이 온 뒤에 보내 주세요.",
    );
  }

  private async run(
    c: Concept,
    kind: Pending["kind"],
    clientId: string,
    text: string | undefined,
    work: (cwd: string) => Promise<Concept>,
  ) {
    if (this.pending.size >= MAX_RUNNING)
      fail(
        "concept_capacity",
        "다른 대화의 답을 만드는 중입니다. 잠시 후 다시 시도해 주세요.",
      );
    const done = (async () => {
      const cwd = path.join(this.root, "work");
      await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
      // Recorded only after a valid answer; a failed call leaves no trace.
      const next = await work(cwd);
      await this.save(next);
      return next;
    })();
    this.pending.set(c.concept_id, {
      kind,
      client_id: clientId,
      text,
      started_at: now(),
      done,
    });
    let next;
    try {
      next = await done;
    } finally {
      this.pending.delete(c.concept_id);
    }
    return this.view(next);
  }

  // An existing project directory keeps its name: the documents get -2, -3…
  private async freeId(base: string) {
    for (let n = 1; n < 100; n++) {
      const suffix = n === 1 ? "" : `-${n}`;
      const id = base.slice(0, 64 - suffix.length) + suffix;
      if (!(await this.taken(id))) return id;
    }
    return `${base.slice(0, 55)}-${randomUUID().slice(0, 8)}`;
  }

  close() {
    this.controller.abort();
  }
}
