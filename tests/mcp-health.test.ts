import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { McpHealth, parseMcpList, type McpProbe } from "../src/media/health.js";
import { fixture } from "./helpers.js";

test("M01 actual Claude list format: all states, Higgsfield alias and credential redaction", () => {
  const parsed = parseMcpList(`Checking MCP server health…
claude.ai higs: https://mcp.higgsfield.ai/mcp?token=SECRET - ✔ Connected
Docs: https://user:SECRET@example.com/mcp - ✓ Connected
login: node server.js --token SECRET - ⚠ Needs authentication
pending: node server.js - ⏸ Pending approval
failed: https://example.com - ✗ Failed to connect
disabled: node x - Disabled
future: node x - New status
spoof: https://evil.test/?next=mcp.higgsfield.ai - Connected
ANSI: https://example.com - \u001b[32m✔ Connected\u001b[0m
not a server`);
  assert.equal(parsed.length, 9);
  assert.equal(parsed[0].name, "claude.ai higs");
  assert.equal(parsed[0].higgsfield, true);
  assert.equal(parsed[7].higgsfield, false);
  assert.deepEqual(
    parsed.map((s) => s.status),
    [
      "connected",
      "connected",
      "needs_auth",
      "pending_approval",
      "failed",
      "disabled",
      "unknown",
      "connected",
      "connected",
    ],
  );
  assert.doesNotMatch(JSON.stringify(parsed), /SECRET|https:|server.js/);
});

test("M02 nonblocking checks coalesce, cache, expire and never preserve false availability after errors", async () => {
  let time = 100000,
    calls = 0,
    resolve!: (v: McpProbe) => void;
  const health = new McpHealth(
    undefined,
    () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    () => time,
  );
  assert.equal(health.snapshot().checking, true);
  for (let i = 0; i < 20; i++) health.snapshot(true);
  assert.equal(calls, 1);
  resolve({
    servers: [{ name: "higs", status: "connected", higgsfield: true }],
    error: null,
  });
  await health.settled();
  assert.equal(health.snapshot().higgsfield.available, true);
  health.snapshot(true);
  assert.equal(calls, 1);
  time += 61000;
  const stale = health.snapshot();
  assert.equal(stale.stale, true);
  assert.equal(stale.higgsfield.available, false);
  assert.equal(calls, 2);
  resolve({ servers: [], error: "check_timeout" });
  await health.settled();
  const failed = health.snapshot();
  assert.equal(failed.higgsfield.available, false);
  assert.equal(failed.higgsfield.status, "unknown");
  health.close();
  time += 61000;
  health.snapshot();
  assert.equal(calls, 2);
});

test("M03 stdio health only initializes/lists tools, does not generate and checks configured tools", async () => {
  const f = await fixture();
  const calls = path.join(f.root, "calls.txt");
  const c = {
    command: process.execPath,
    args: [path.resolve("tests/fixtures/mcp-server.mjs")],
    env: { CALLS_FILE: calls },
    generateTool: "generate",
    statusTool: "status",
    statusArgument: "job_id",
    jobIdPath: "job_id",
    statusPath: "status",
    assetPath: "asset",
  };
  const good = new McpHealth(c),
    bad = new McpHealth({ ...c, generateTool: "missing" });
  try {
    good.snapshot();
    await good.settled();
    assert.equal(good.snapshot().higgsfield.available, true);
    await assert.rejects(() => fs.stat(calls), { code: "ENOENT" });
    bad.snapshot();
    await bad.settled();
    assert.equal(bad.snapshot().higgsfield.available, false);
    assert.equal(bad.snapshot().servers[0].status, "failed");
  } finally {
    good.close();
    bad.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
