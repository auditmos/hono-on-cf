# Plan: Cloudflare standards, deploy readiness & agent-doc truth

> Source PRD: [#43](https://github.com/auditmos/hono-on-cf/issues/43) — supersedes the raw audit in [#42](https://github.com/auditmos/hono-on-cf/issues/42)

## Architectural decisions

Durable decisions that apply across all phases:

- **Repository identity**: template first. This is a GitHub template, not a product repo. Every phase must leave a zero-credential clone fully green. Any capability requiring credentials degrades to an explanatory skip, never a failure.
- **Nothing is deployed**: no Cloudflare account, no provisioned database branch, no live environment behind the placeholder domains. Deployment phases are accepted on dry-run plus a demonstrated credentials-absent path. Live validation is deferred to the first real deployment and is not part of this plan.
- **Architecture style**: pnpm monorepo. A Hono REST API on Cloudflare Workers using the entrypoint-class pattern, consuming one shared data-layer package. Unchanged by this plan.
- **Data model**: unchanged. No schema, entity, or query changes anywhere in this plan.
- **Authorization**: unchanged. The Better Auth integration is shipped; session validity plus an approval flag remains the gate. Out of scope throughout.
- **Error handling**: unchanged. Services return a Result type and never throw; middleware that must short-circuit throws the framework's HTTP exception; the global handler maps both. No new error class.
- **Dependency resolution**: the shared data layer resolves from source with no build artifact. Established in phase 5 and assumed by every phase after it.
- **Test strategy**: the Worker suite runs in workerd against real bindings; the data-layer suite stays in Node because it has no bindings to exercise. No real-SQL integration lane in this plan.
- **Deployment model**: versioned upload followed by gradual rollout, with promotion gated on the readiness probe. Never a direct replace-in-place deploy.
- **Configuration split**: by sensitivity, not convenience. Plain values live in versioned per-environment config; only credentials are secrets, pushed in bulk.
- **Custom domains**: bound as custom domains rather than route patterns, so DNS records and certificates are created automatically. They stay placeholders in the template, supplied through the initialization prompt.

### Cross-phase ordering notes

- **Phase 1 before everything.** The check scripts it invokes keep their names through every later phase, so putting CI first costs no churn and protects all subsequent work.
- **Phase 3 lands early on purpose.** Once doc drift fails the build, phases 4–10 are *forced* to keep documentation honest as they delete and add things. Phase 5 in particular removes a documented build command, and the check is what guarantees that gets caught.
- **One document is left deliberately wrong in phase 2.** The rule mandating the workerd test pool is not fiction — it is a correct target the code has not met. Phase 2 leaves it alone; phase 6 makes it true. Deleting and re-adding it would be pure churn.
- **Phase 5 before phase 6.** Both change how the application resolves and typechecks its dependency; sequencing them avoids solving that problem twice.
- **Phase 5 will surface pre-existing type errors** currently hidden behind a declaration boundary. That is the intended effect, not a regression. Budget a cleanup pass inside that phase.

---

## Phase 1: Pull requests are gated by CI

**User stories**: 1, 15, 16, 17, 18, 19

### What to build

A reusable check workflow — lint, typecheck, tests, unused-code detection — that runs on every pull request and is also invoked by the release path, so the checks gating a merge and the checks gating a release resolve to one definition and cannot drift.

Bot-authored pull requests must trigger checks, which the default automation token deliberately does not do. Where a token is absent (a fresh template clone), human pull requests are still checked and bot ones simply are not — no failure, no red workflow.

This phase makes CI the authoritative contract rather than the local git hooks, which are already disabled inside CI today.

### Acceptance criteria

- [ ] A pull request containing a deliberate lint error is blocked
- [ ] A pull request containing a deliberate type error is blocked
- [ ] A pull request containing a failing test is blocked
- [ ] A pull request containing newly-unused code is blocked
- [ ] The release path and the pull-request path invoke the same workflow definition, with no duplicated step list
- [ ] A bot-authored pull request shows checks running
- [ ] With no tokens configured, a clone still shows all checks green on a pull request

---

## Phase 2: Agent docs describe only what exists

**User stories**: 37, 38, 39, 40, 41, 42, 43, 44

### What to build

Delete every piece of agent-facing documentation that describes code which is not there. The data-service agent doc currently documents queue consumers, Durable Objects, and Workflows directories, plus an inbound webhooks endpoint with a signature-verification pattern and an idempotency table — none of which exists. It is deleted outright, not relocated to pattern documents and not marked as future.

Correct the documentation that is present but wrong: references to a sibling application that is not in this repository, an instruction to initialize the database in the request handler when the code correctly does it in the entrypoint constructor, a stale service title, and a reference to a deleted example. Remove a rules section covering a serialization concern that does not apply to this project.

Bring the root agent file into line with the per-package convention, so a harness that reads only the root file gets the same depth as one reading the package files. Verify every link in the agent index resolves.

Add a Cloudflare documentation server configuration so agents consult current platform documentation rather than training data.

**Leave the workerd test-pool mandate in place** — it is a target phase 6 fulfils, not fiction.

### Acceptance criteria

- [ ] No agent-facing document references webhooks, queues, Durable Objects, or Workflows
- [ ] No document references an application outside this repository
- [ ] The documented database initialization location matches where the code does it
- [ ] Every link in the agent index resolves
- [ ] The root agent file carries the same depth as the package-level ones
- [ ] A documentation server configuration is present and loads
- [ ] Reading only the agent docs, an agent can name every directory that exists and none that do not

---

## Phase 3: Doc drift fails the build

**User stories**: 45

### What to build

An executable check that verifies agent-facing documents reference only directories, endpoints, commands, and links that actually exist, wired into the pull-request checks from phase 1.

This is the highest-leverage item in the plan despite being the least visible. Every other correction here is one-time; this is the only thing preventing the same audit from being necessary again. Landing it now — rather than at the end — means phases 4 through 10 are held to it as they delete and add things.

### Acceptance criteria

- [ ] Reintroducing a reference to a deleted directory fails the check
- [ ] Referencing a script that does not exist fails the check
- [ ] A broken index link fails the check
- [ ] The check runs on every pull request and blocks merge on failure
- [ ] The check passes against the repository state left by phase 2

---

## Phase 4: Dead surface and stale metadata removed

**User stories**: 8, 9, 31, 35, 36

### What to build

Mechanical cleanup with no design decisions remaining. Delete the empty scheduled-handler stub along with its entrypoint export and the commented-out cron trigger — dead surface that advertises a capability the Worker does not have. Remove unused-code exclusions for directories that no longer exist, which currently mask genuinely unused code added later. Drop the JSX setting from a Worker containing no JSX. Remove the empty submodule file.

Pin the Node version so local toolchains match CI instead of floating on whatever the runner considers current. Correct the declared license metadata in both packages to match the license file actually shipped.

### Acceptance criteria

- [ ] The Worker exports no scheduled handler and declares no cron trigger
- [ ] Unused-code exclusions reference only paths that exist
- [ ] No JSX configuration remains in the Worker
- [ ] The empty submodule file is gone
- [ ] A pinned Node version is present and matches what CI uses
- [ ] Declared license metadata matches the shipped license file in every package
- [ ] All checks from phases 1 and 3 remain green

---

## Phase 5: data-ops resolves from source, no build

**User stories**: 29, 32, 33, 34

### What to build

Remove the build step from the shared data layer entirely. Its internal path aliases are the root cause of the coupling — they are what forces a compile-and-rewrite build, which is what forces consumers to resolve through compiled output. Replace them with relative imports, and the alias-rewriting tool, the build step, and the compiled output directory all become removable together.

The package then resolves directly from source. It is workspace-internal and has never been published, so compiled output earns nothing.

Two consequences are deliberate. The data layer's source is now compiled under the application's TypeScript configuration, which resolves the separate type-source split for free — the separately-pinned platform types package leaves that path, and both packages draw runtime types from one source. And type errors inside the data layer now surface during application typechecks instead of hiding behind generated declarations. Expect a batch of previously-invisible errors; fixing them is part of this phase.

Remove the reminder hook that exists solely to prompt rebuilds. It becomes obsolete, and removing it means any regression shows up as a real failure rather than a prompt.

Documentation referencing the build command must be updated in the same change — the phase 3 check will enforce this.

### Acceptance criteria

- [ ] A schema edit is observable in an application typecheck with no intervening build command
- [ ] No build step, alias-rewriting tool, or compiled output directory remains for the shared package
- [ ] No internal path aliases remain in the shared package's source
- [ ] Both packages draw platform runtime types from a single source
- [ ] The full check suite passes from a clean checkout with no build having run
- [ ] The rebuild reminder hook is removed
- [ ] Previously-hidden type errors surfaced by this change are fixed, not suppressed
- [ ] No documentation references the removed build command

---

## Phase 6: Rate limiting proven in workerd

**User stories**: 7, 24, 30, 47

### What to build

Move the Worker suite into the workerd runtime using the Cloudflare test pool, reaching genuine bindings through the test environment. The rate limiter is a real platform binding with real semantics and is currently never exercised — every test asserts against a hand-rolled mock that returns whatever the test author chose. At least one suite must drive a real binding past its configured limit and observe an actual rejection.

The data-layer suite stays in Node. It exercises no bindings; moving it would add runtime cost and remove nothing. One test command continues to run both.

Make the rate limiter's behavior for unidentifiable callers an explicit decision rather than an accident. Collapsing every such caller into one shared bucket is defensible in production, where the client-address header is essentially always present. It is actively wrong in local development and in the workerd test runtime, where it makes concurrent tests contend for a single bucket. Distinguish the contexts.

Raise or exclude the readiness probe's rate limit. This is a real operational trap, not a theoretical one: uptime monitors poll from shared egress addresses, so a per-address limit sized for human traffic rate-limits an entire monitoring provider into false alerts. This phase is where a real binding exists to verify the fix against.

The workerd mandate left standing in phase 2 becomes true here.

### Acceptance criteria

- [ ] At least one suite executes in workerd and asserts a real rate-limit binding rejects after its configured limit, with no mock in the path
- [ ] Deleting the rate-limiter middleware from a route makes that suite fail
- [ ] The single test command runs both the workerd and Node suites
- [ ] The data-layer suite still runs in Node
- [ ] Unidentifiable-caller behavior is explicit, context-aware, and covered by a test
- [ ] Concurrent workerd tests do not contend for a shared rate-limit bucket
- [ ] The readiness probe tolerates monitoring at realistic polling frequency
- [ ] The suite runs offline with no credentials and no container runtime

---

## Phase 7: Worker config adopts platform defaults

**User stories**: 13, 14, 25, 26, 46, 48

### What to build

Enable Smart Placement on the server environments so the Worker runs near the single-region database rather than near an arbitrary visitor — today every request's latency is dominated by that round trip. Local development is excluded; it has no meaningful placement decision.

Enable source-map upload. Logging and tracing are already on, but without source maps the stack traces they produce arrive minified, so an incident starts with reconstructing minified output.

Split configuration by sensitivity. Environment name and allowed origins are plain values currently settable only as secrets, which makes them invisible, unversioned, and undiffable; they move into versioned per-environment configuration so a config change can be reviewed in the pull request that makes it. Only genuine credentials remain secrets, and the one-at-a-time push loop is replaced with a single bulk operation.

### Acceptance criteria

- [ ] A config dry-run succeeds for every environment
- [ ] Smart Placement is enabled on the server environments and absent from local development
- [ ] Source-map upload is enabled
- [ ] Environment name and allowed origins appear in versioned per-environment configuration
- [ ] Only credentials remain secrets
- [ ] Secrets are pushed in one bulk operation, replacing the per-secret loop
- [ ] An environment configuration change is fully visible in a diff
- [ ] Unminified stack traces are confirmed once a deployment exists — deferred with phase 9

---

## Phase 8: Generated types cannot go stale

**User stories**: 27, 28

### What to build

A freshness check comparing the committed runtime type definitions against the configured compatibility date and toolchain version, failing when they diverge, wired into the pull-request checks.

Today those definitions were generated against a compatibility date more than a year older than the one configured, and the workflow that bumps the date documents that it cannot regenerate them. After this phase, that workflow's own pull request is subject to the check, so the two can no longer silently diverge.

### Acceptance criteria

- [ ] Bumping the compatibility date without regenerating types fails the check
- [ ] Regenerating types makes the check pass
- [ ] The check runs on every pull request and blocks merge on failure
- [ ] The compatibility-date bump workflow's own pull request is subject to it
- [ ] Committed type definitions match the currently configured compatibility date

---

## Phase 9: Deployment ships, credential-guarded

**User stories**: 1, 2, 3, 10, 11, 12, 20, 21, 22, 23

### What to build

A deploy pipeline: staging from the main branch, production from a tag or explicit manual approval, so a merge can never reach production by accident. Each deploy uploads a version and rolls it out gradually rather than replacing production instantly, so a bad deploy affects a fraction of traffic before it affects all of it. Promotion is gated on the readiness probe — the endpoint that actually verifies database connectivity, since the liveness endpoint would pass on a Worker that cannot serve traffic. A failed gate halts the rollout.

The defining constraint is the credential guard. The job first checks whether deployment credentials are configured, and when they are not it skips with a notice naming the exact secret to add. A fresh template clone sees green checkmarks and a clear instruction, not a red workflow it never asked to run. Adding credentials is then sufficient to enable deploys with no code change.

This phase cannot be validated end-to-end — nothing is deployed and nothing will be provisioned here. Acceptance is dry-run plus a demonstrated skip path plus review of the gate, rollout, and rollback steps. The first real deployment is the outstanding validation, and that is stated rather than glossed.

### Acceptance criteria

- [ ] The workflow dry-runs cleanly for every environment
- [ ] With no credentials configured, the job skips with a notice naming the required secret and the workflow reports green
- [ ] With credentials configured, the same workflow deploys — no code change required
- [ ] Staging deploys automatically from the main branch
- [ ] Production requires a tag or explicit manual approval and is unreachable from a plain merge
- [ ] Deploys upload a version and roll out gradually, never replacing in place
- [ ] Promotion is gated on the readiness probe, not the liveness probe
- [ ] A failed readiness gate halts the rollout
- [ ] Rollout and rollback steps are present and reviewed
- [ ] **Outstanding**: validation against a live readiness probe, deferred to the first real deployment

---

## Phase 10: Template deploy ergonomics

**User stories**: 4, 5, 6

### What to build

Make the deploy path discoverable and configurable for someone who just cloned the template. The initialization script prompts for a custom domain, so a consumer does not silently end up serving production from a platform subdomain because the route definitions are commented-out placeholders. The script stays idempotent and never overwrites values already filled in, so it can be re-run safely during incremental configuration.

Rewrite the deployment documentation to describe the CI-driven pipeline rather than the local command it replaces, so the documented path and the supported path are the same one.

This phase is fully verifiable with no credentials, unlike phase 9.

### Acceptance criteria

- [ ] The initialization script prompts for a custom domain and wires it as a custom domain binding, not a route pattern
- [ ] Re-running the script never overwrites values already filled in
- [ ] Running the script on a fresh clone produces a configuration with no placeholder domains left unaddressed
- [ ] Deployment documentation describes the CI pipeline, not a local command
- [ ] No documentation references the superseded manual deploy path
- [ ] The phase 3 doc check passes against the rewritten documentation

---

## Definition of done (all phases)

- [ ] A clean clone with zero credentials passes every check and shows no failing workflow
- [ ] No agent-facing document references anything that does not exist
- [ ] At least one test executes against a real platform binding in workerd
- [ ] A compatibility-date bump cannot land without regenerated types
- [ ] A schema edit surfaces in a consumer typecheck with no build step
- [ ] Adding deployment credentials is sufficient to enable deploys, with no code change

## Explicitly not in this plan

- Reintroducing webhooks, queues, Durable Objects, or Workflows — their docs are deleted here, their code is not restored
- Reintroducing the removed error class
- Authentication redesign or new product endpoints
- A sibling application — references are removed, not implemented
- Real-SQL integration testing. Two gaps are consciously accepted: the data layer's client query functions have no direct tests, and the client service's error paths are covered only indirectly. Candidate for a follow-up PRD
- Validating deployment against live infrastructure
- Multi-region or read-replica database topology
- Dependency version bumps beyond what a specific phase requires
