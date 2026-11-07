import { ajv } from "../contracts/validate.js";

const text = (maxLength: number) => ({ type: "string", maxLength });
const list = (maxItems: number, maxLength: number) => ({
  type: "array",
  maxItems,
  items: { type: "string", minLength: 1, maxLength },
});

// Chat turns: Claude gets this as --json-schema and the server checks the
// structured output against it again before recording the turn. The draft is
// only the concept card; documents come from COMPOSE_SCHEMA in their own call.
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "choices", "ready", "draft"],
  properties: {
    reply: { type: "string", minLength: 1, maxLength: 600 },
    choices: list(4, 40),
    ready: { type: "boolean" },
    draft: {
      type: "object",
      additionalProperties: false,
      required: [
        "project_id",
        "name",
        "business",
        "audience",
        "primary_action",
        "must_include",
        "tone",
        "sections",
        "images",
        "missing",
      ],
      properties: {
        // Same rule as projectDirectory(), lowercased; empty until named.
        project_id: {
          type: "string",
          maxLength: 64,
          pattern: "^(?:[a-z0-9][a-z0-9-]{0,63})?$",
        },
        name: text(80),
        business: text(400),
        audience: text(300),
        primary_action: text(300),
        must_include: list(12, 200),
        tone: text(300),
        sections: list(12, 120),
        images: text(500),
        missing: list(10, 80),
      },
    },
  },
} as const;

// The 문서 만들기 call: both documents and a project ID, nothing else.
export const COMPOSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project_id", "prd", "design"],
  properties: {
    project_id: {
      type: "string",
      maxLength: 64,
      pattern: "^[a-z0-9][a-z0-9-]{0,63}$",
    },
    prd: { type: "string", minLength: 1, maxLength: 12000 },
    design: { type: "string", minLength: 1, maxLength: 6000 },
  },
} as const;

export type ConceptDraft = {
  project_id: string;
  name: string;
  business: string;
  audience: string;
  primary_action: string;
  must_include: string[];
  tone: string;
  sections: string[];
  images: string;
  missing: string[];
};
export type ConceptOutput = {
  reply: string;
  choices: string[];
  ready: boolean;
  draft: ConceptDraft;
};
export type ComposeOutput = { project_id: string; prd: string; design: string };

export const validOutput = ajv.compile<ConceptOutput>(OUTPUT_SCHEMA);
export const validCompose = ajv.compile<ComposeOutput>(COMPOSE_SCHEMA);
