const assert = require("node:assert/strict");
const test = require("node:test");
const { setTimeout: sleep } = require("node:timers/promises");
const { deployPages, deployWithRecovery, retryPages } = require("../.github/scripts/deploy-pages.cjs");

const context = { repo: { owner: "TestLeague", repo: "league-site" }, sha: "a".repeat(40) };
const create = "POST /repos/{owner}/{repo}/pages/deployments";
const status = "GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}";
const cancel = "POST /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}/cancel";
const url = "https://testleague.github.io/league-site/";

function harness(statuses = [], createError, { head = context.sha, buildType = "workflow" } = {}) {
  const requests = [];
  const delays = [];
  const output = new Map();
  const core = {
    getIDToken: async () => "fictional-token",
    setOutput: (key, value) => output.set(key, value),
    info() {},
    warning() {},
  };
  const github = {
    async request(route, parameters) {
      requests.push({ route, parameters });
      if (route === create) {
        if (createError) throw createError;
        return { data: { id: "deployment-id", page_url: url } };
      }
      if (route === status) {
        assert.ok(statuses.length, "Unexpected Pages status request");
        const next = statuses.shift();
        if (next instanceof Error) throw next;
        return { data: { status: next } };
      }
      if (route === "GET /repos/{owner}/{repo}/pages") return { data: { build_type: buildType } };
      if (route === "GET /repos/{owner}/{repo}/git/ref/heads/main") return { data: { object: { sha: head } } };
      assert.equal(route, cancel);
    },
  };
  const attempt = (deploy) => (artifactId = "8675", options = {}) => deploy(github, context, core, artifactId, {
    wait: async (ms) => { delays.push(ms); },
    ...options,
  });
  return { run: attempt(deployPages), first: attempt(deployWithRecovery), retry: attempt(retryPages), requests, output, delays };
}

function httpError(status, headers = {}, message = "GitHub request failed") {
  return Object.assign(new Error(message), { status, response: { headers } });
}

test("deploys the exact uploaded artifact and waits for Pages to report success", async () => {
  const { run, requests, output } = harness(["syncing_files", "succeed"]);
  await run();
  assert.deepEqual(requests.map(({ route }) => route), [create, status, status]);
  assert.deepEqual(requests[0].parameters, {
    ...context.repo,
    artifact_id: 8675,
    pages_build_version: context.sha,
    oidc_token: "fictional-token",
  });
  assert.equal(requests[1].parameters.pages_deployment_id, "deployment-id");
  assert.equal(output.get("page_url"), url);
});

test("fails before contacting Pages when the artifact ID is missing or invalid", async () => {
  const { run, requests } = harness();
  for (const value of ["", "not-an-id", "9007199254740992"]) {
    await assert.rejects(run(value), /did not provide a valid artifact ID/);
  }
  assert.deepEqual(requests, []);
});

test("recovers after repeated transient status errors without creating another deployment", async () => {
  const unavailable = httpError(503);
  const { run, requests, delays } = harness([unavailable, unavailable, unavailable, "succeed"]);
  await run();
  assert.deepEqual(requests.map(({ route }) => route), [create, status, status, status, status]);
  assert.deepEqual(delays, [5000, 5000, 5000]);
});

test("honors Retry-After on transient and rate-limited status reads", async () => {
  const future = new Date("2100-01-01T00:00:00Z").toUTCString();
  const { run, requests, delays } = harness([
    httpError(403, { "retry-after": "17" }),
    httpError(503, { "retry-after": "9" }),
    httpError(429, { "retry-after": future }),
    "succeed",
  ]);
  await run();
  assert.deepEqual(delays, [17_000, 9000, 600_000]);
  assert.deepEqual(requests.map(({ route }) => route), [create, status, status, status, status]);
});

test("uses the primary rate limit reset when GitHub omits Retry-After", async () => {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const { run, delays } = harness([
    httpError(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }),
    "succeed",
  ]);
  await run();
  assert.deepEqual(delays, [600_000]);
});

test("backs off through secondary rate limits and resets after a successful read", async () => {
  const rateLimited = httpError(403, {}, "You have exceeded a secondary rate limit.");
  const { run, delays } = harness([rateLimited, rateLimited, "updating_pages", rateLimited, "succeed"]);
  await run();
  assert.deepEqual(delays, [60_000, 120_000, 5000, 60_000]);
});

test("a permissions failure stops status polling immediately", async () => {
  const denied = httpError(403, { "x-ratelimit-remaining": "1" });
  const { run, requests, delays } = harness([denied]);
  await assert.rejects(run(), denied);
  assert.deepEqual(requests.map(({ route }) => route), [create, status, cancel]);
  assert.deepEqual(delays, []);
});

test("the deployment deadline bounds a long Retry-After wait", async () => {
  const { run, requests } = harness([httpError(429, { "retry-after": "1800" })]);
  await assert.rejects(run("8675", { timeoutMs: 20, wait: sleep }), (error) =>
    error.name === "TimeoutError" || error.cause?.name === "TimeoutError");
  assert.deepEqual(requests.map(({ route }) => route), [create, status, cancel]);
});

test("an ambiguous creation failure never causes another deploy request", async () => {
  const unavailable = Object.assign(new Error("Unavailable"), { status: 502 });
  const { run, requests } = harness([], unavailable);
  await assert.rejects(run(), unavailable);
  assert.deepEqual(requests.map(({ route }) => route), [create]);
});

test("reports terminal failure without cancelling a finished deployment", async () => {
  const { run, requests } = harness(["deployment_content_failed"]);
  await assert.rejects(run(), /deployment_content_failed/);
  assert.deepEqual(requests.map(({ route }) => route), [create, status]);
});

test("retries a confirmed deployment failure with a fresh artifact only while main is current", async () => {
  const { first, retry, requests, output } = harness(["deployment_failed", "succeed"]);
  await first();
  assert.equal(output.get("retry"), "true");
  await retry("8676");
  assert.deepEqual(requests.filter(({ route }) => route === create).map(({ parameters }) => parameters.artifact_id),
    [8675, 8676]);
  assert.equal(requests.some(({ route }) => route === cancel), false);

  const stale = harness(["deployment_failed"], undefined, { head: "f".repeat(40) });
  await stale.first();
  await stale.retry("8676");
  assert.equal(stale.requests.filter(({ route }) => route === create).length, 1);
});

test("a content failure or changed Pages source needs human action, and a second failure is terminal", async () => {
  const invalid = harness(["deployment_content_failed"]);
  await assert.rejects(invalid.first(), /deployment_content_failed/);
  assert.equal(invalid.output.has("retry"), false);

  const disabled = harness(["deployment_failed"], undefined, { buildType: "legacy" });
  await disabled.first();
  await assert.rejects(disabled.retry("8676"), /Select GitHub Actions/);
  assert.equal(disabled.requests.filter(({ route }) => route === create).length, 1);

  const twice = harness(["deployment_failed", "deployment_failed"]);
  await twice.first();
  await assert.rejects(twice.retry("8676"), /deployment_failed/);
  assert.equal(twice.requests.filter(({ route }) => route === create).length, 2);
});

test("logs the HTTP status and request ID without leaking the deployment request", async () => {
  const denied = httpError(403, { "x-github-request-id": "FA0B:1234" }, "request body with sensitive data");
  denied.request = { body: "fictional-token" };
  const { first, output } = harness([], denied);
  await assert.rejects(first(), (error) => error.message === "GitHub API request failed (HTTP 403, request FA0B:1234)." &&
    error.request === undefined && error.cause === undefined);
  assert.equal(output.has("retry"), false);
});

test("cancels the pending deployment when the workflow is cancelled", async () => {
  const cancellation = new AbortController();
  const { run, requests } = harness(["syncing_files"]);
  await assert.rejects(run("8675", {
    cancellation: cancellation.signal,
    wait: async () => cancellation.abort(),
  }), { name: "AbortError" });
  assert.deepEqual(requests.map(({ route }) => route), [create, status, cancel]);
  assert.equal(requests[2].parameters.pages_deployment_id, "deployment-id");
});
