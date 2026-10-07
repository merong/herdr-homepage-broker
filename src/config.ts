import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Config, fail } from "./contracts/types.js";
export const defaultConfigFile = () =>
  path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "herdr-homepage/config.json",
  );
export async function config(file?: string): Promise<Config> {
  const root =
    process.env.HOMEPAGE_STATE_DIR ??
    path.join(os.homedir(), ".local/state/herdr-homepage");
  const herdrRoot = process.env.HERDR_CONFIG_PATH
    ? path.dirname(path.resolve(process.env.HERDR_CONFIG_PATH))
    : path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
        "herdr",
      );
  let user: any = {};
  if (file) user = JSON.parse(await fs.readFile(file, "utf8"));
  else {
    try {
      user = JSON.parse(await fs.readFile(defaultConfigFile(), "utf8"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (user.session && user.session !== "homepage")
    fail("session_mismatch", "Only homepage is supported");
  if (user.model && user.model !== "claude-opus-5-5")
    fail("model_mismatch", "Claude Opus 5.5 is required");
  if (user.effort && user.effort !== "high")
    fail("effort_mismatch", "high effort is required");
  const c: Config = {
    stateRoot: path.resolve(root),
    herdrBin: process.env.HERDR_BIN_PATH ?? "herdr",
    socketPath: path.join(herdrRoot, "sessions/homepage/herdr.sock"),
    skills: [],
    allowExecution: true,
    autoStart: false,
    projectsRoot:
      process.env.HOMEPAGE_PROJECTS_ROOT ??
      path.join(os.homedir(), "herdr-homepages"),
    ...user,
    session: "homepage",
    model: "claude-opus-5-5",
    effort: "high",
    maxProjects: 2,
    maxPreviews: 2,
    web: { enabled: true, port: 7318, ...user.web },
  };
  if (
    (user.web !== undefined &&
      (!user.web ||
        typeof user.web !== "object" ||
        Array.isArray(user.web) ||
        Object.keys(user.web).some(
          (key) => !["enabled", "port"].includes(key),
        ))) ||
    typeof c.web!.enabled !== "boolean" ||
    !Number.isInteger(c.web!.port) ||
    c.web!.port < 0 ||
    c.web!.port > 65535
  )
    fail(
      "invalid_config",
      "web accepts enabled:boolean and port:0..65535; host is always 127.0.0.1",
    );
  if (
    typeof c.allowExecution !== "boolean" ||
    typeof c.autoStart !== "boolean" ||
    !Array.isArray(c.skills) ||
    c.skills.some((s) => typeof s !== "string" || !path.isAbsolute(s))
  )
    fail(
      "invalid_config",
      "allowExecution and autoStart must be boolean; skills must be absolute paths",
    );
  if (c.mcp) {
    for (const key of [
      "command",
      "generateTool",
      "statusTool",
      "jobIdPath",
      "statusPath",
      "assetPath",
      "statusArgument",
    ] as const)
      if (typeof c.mcp[key] !== "string" || !c.mcp[key])
        fail("invalid_config", `mcp.${key} is required`);
    if (
      !Array.isArray(c.mcp.args) ||
      c.mcp.args.some((a) => typeof a !== "string")
    )
      fail("invalid_config", "mcp.args must be a string array");
  }
  c.stateRoot = path.resolve(c.stateRoot);
  if (typeof c.projectsRoot !== "string" || !path.isAbsolute(c.projectsRoot))
    fail("invalid_config", "projectsRoot must be an absolute path");
  c.projectsRoot = path.resolve(c.projectsRoot);
  c.socketPath = path.resolve(c.socketPath);
  if (
    path.basename(c.socketPath) !== "herdr.sock" ||
    path.basename(path.dirname(c.socketPath)) !== "homepage" ||
    path.basename(path.dirname(path.dirname(c.socketPath))) !== "sessions"
  )
    fail(
      "session_mismatch",
      "Socket must address sessions/homepage/herdr.sock",
    );
  // Explicit skills stay in c.skills; only legacy runs fall back to discovery.
  c.discoveredSkills = c.skills.length ? [] : await discoverHomepageSkills();
  return c;
}
export const claudeRoot = () =>
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
export const injectedSkills = (
  c: Config,
  mode: "claude-native" | "pm-led" | "legacy",
) =>
  mode === "claude-native" || c.skills.length
    ? c.skills
    : (c.discoveredSkills ?? []);
export async function discoverHomepageSkills(root = claudeRoot()) {
  // Only the homepage skill is selected; unrelated installed skills stay disabled.
  for (const name of ["higgsfield-websites", "higgsfield-website-builder"]) {
    const file = path.join(root, "skills", name, "SKILL.md");
    try {
      if ((await fs.stat(file)).isFile()) {
        await fs.access(file, fs.constants.R_OK);
        return [file];
      }
    } catch {}
  }
  return [];
}
export function actionGuard(c: Config) {
  if (
    process.env.HERDR_SESSION !== "homepage" ||
    (process.env.HERDR_SOCKET_PATH &&
      path.resolve(process.env.HERDR_SOCKET_PATH) !== c.socketPath)
  )
    fail("session_mismatch", "Open this action in the homepage session");
}
export const stateDir = (c: Config) =>
  path.join(c.stateRoot, "sessions/homepage");
export const brokerSocket = (c: Config) =>
  path.join(stateDir(c), "broker.sock");
