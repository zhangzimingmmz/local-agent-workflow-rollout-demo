# Two-workstation Codex rollout

This runbook validates that separate human sessions can deliver one requirement through role-owned Git branches, pull requests, reviews, and observable workflow state. It uses the isolated control plane at `http://100.64.0.5:8089` and the public work repository at `https://github.com/zhangzimingmmz/local-agent-workflow-rollout-demo`.

The rollout instance does not receive the production GitHub Webhook. After an accepted pull request is merged, reconciliation detects the merge within 60 seconds. The completed 8088 demonstration remains unchanged.

## Access and account boundaries

An operator securely transfers only the assigned files from `/opt/local-agent-workflow-rollout/accounts/`. Do not paste their contents into chat, issues, pull requests, shell history, or the repository.

| Workstation | Account sessions | Owner work | Review work |
| --- | --- | --- | --- |
| A | Alice, Carol, Erin | `DES-001`, `DEV-001`, `TST-001` | `DES-002`, `DEV-002`, `TST-002` |
| B | Bob, Dave, Frank | `DES-002`, `DEV-002`, `TST-002` | `DES-001`, `DEV-001`, `TST-001` |

Use one fresh Codex session and one separate clone per Account. Close the session before changing Accounts; never source two Account files in the same session. Account files bind Alice, Carol, and Erin to `workstation-a`, and Bob, Dave, and Frank to `workstation-b`.

Each workstation needs Tailscale access to `100.64.0.5`, Node.js 22 or newer, Git, GitHub CLI, and permission to push branches and create pull requests in the rollout repository. Verify access without loading a workflow token:

```bash
curl --fail --silent --show-error "http://100.64.0.5:8089/health"
gh auth status
```

The health response must report `"status":"ok"`. GitHub CLI must report the intended human GitHub identity.

## Rollout requirement

`REQ-001` delivers first-class status lookup for either a Requirement ID or Work Item ID. The accepted design decides the exact interface; the expected direction is a requirement-aware control-plane endpoint and a CLI `status <id>` command that returns the matching entity without guessing its type.

| Work Item | Account | Expected scope and evidence |
| --- | --- | --- |
| `DES-001` | Alice | Problem, solution, boundaries, risks, and data ownership in `deliverables/rollout/design/status-lookup.md` |
| `DES-002` | Bob | Executable success, error, authorization, restart, and compatibility scenarios in `deliverables/rollout/design/status-acceptance.md` |
| `DEV-001` | Carol | Central API/persistence implementation, a reversible schema migration that makes Requirement status queryable as a first-class record, and tests |
| `DEV-002` | Dave | Project-local Skill and CLI behavior for requirement-or-work-item status lookup |
| `TST-001` | Erin | Independent automated results and evidence manifest under `deliverables/rollout/test/` |
| `TST-002` | Frank | Human-readable acceptance report under `deliverables/rollout/test/acceptance-report.md` |

Design decisions are authoritative only after both design Work Items are Accepted. Developers must not invent a conflicting interface while design review is pending.

## Start an Account session

Create an Account-specific clone. Replace `<account>` with the current Account name in lower case and `<secure-account-file>` with the file received from the operator.

```bash
mkdir -p "$HOME/workflow-rollout"
git clone "https://github.com/zhangzimingmmz/local-agent-workflow-rollout-demo.git" "$HOME/workflow-rollout/<account>"
cd "$HOME/workflow-rollout/<account>"
set -a
. "<secure-account-file>"
set +a
export TEAM_WORKFLOW_SESSION_ID="$(node -e 'console.log(crypto.randomUUID())')"
test -n "$TEAM_WORKFLOW_WORKSTATION_ID"
test -n "$TEAM_WORKFLOW_SESSION_ID"
```

Generate the session ID immediately before launching Codex. Do not save it in the Account file, shell profile, repository, issue, or chat; discard it when the session closes. It is an opaque correlation ID, not a hostname, username, or hardware identifier.

The repository includes `.agents/skills/team-workflow/`, so a fresh Codex session can invoke `$team-workflow` without installing a global Skill. Start Codex from this shell and clone, then give it one Work Item only:

```text
Use $team-workflow to complete <work-item-id> according to docs/ROLLOUT.md. Use only the authenticated Account, preserve unrelated work, and stop for my explicit approval immediately before pushing or creating a pull request.
```

The session must run `whoami`, `list`, `show`, `claim`, `policy`, and `start` before producing the Artifact. `whoami` must show the expected Account and assigned Workstation; stop if either differs. The branch must use `work/<work-item-id>-<slug>`.

## Submit and review

The Owner runs the checks required by Effective Guidance, inspects the diff, and commits only Work Item files. After the human approves the external write, the Owner pushes the branch, opens a pull request to `main`, and runs:

```bash
node ".agents/skills/team-workflow/scripts/workflow.mjs" submit "<work-item-id>" --pr "<pull-request-url>" --artifact "<kind>:<path>"
```

Repeat `--artifact "<kind>:<path>"` for every declared Artifact. A successful command means Submitted, not Accepted or Integrated.

The configured Reviewer opens a fresh session with the Reviewer Account file and a separate clone, generates a new `TEAM_WORKFLOW_SESSION_ID`, and launches Codex from that environment. Ask Codex to inspect the Work Item, Effective Guidance, pull-request diff, checks, and Artifact paths:

```text
Use $team-workflow to review <work-item-id> from <pull-request-url>. Accept only if the Git evidence, Effective Guidance, checks, and declared Artifacts agree; otherwise reject with a concrete recovery note.
```

The Reviewer uses exactly one decision:

```bash
node ".agents/skills/team-workflow/scripts/workflow.mjs" review "<work-item-id>" --accept --note "<review conclusion>"
node ".agents/skills/team-workflow/scripts/workflow.mjs" review "<work-item-id>" --reject --note "<required recovery action>"
```

Merge only an Accepted pull request. Wait up to 60 seconds for reconciliation, then confirm the Work Item is Integrated at `http://100.64.0.5:8089/` before starting dependent work.

Execute the stages in dependency order:

1. Alice and Bob work in parallel on `DES-001` and `DES-002`, then cross-review and merge.
2. Carol and Dave work in parallel on `DEV-001` and `DEV-002`, then cross-review and merge.
3. Erin completes `TST-001`; Frank reviews and merges it.
4. Frank completes `TST-002`; Erin reviews and merges it.

## Acceptance evidence

The rollout passes when the dashboard shows all six Work Items as Integrated and `REQ-001` as Completed. Preserve these facts in `TST-002`:

- six distinct authenticated Accounts and six Codex Agent Runs;
- exactly two configured Workstations and distinct fresh Owner/Reviewer Agent Sessions, reconstructed from Activity Events without hostnames or prompts;
- the Effective Guidance snapshot and source versions for every run;
- pull-request URL, commit SHA, Artifact paths, reviewer, and merge SHA for every Work Item;
- observed Submitted, Accepted, and Integrated events in order;
- at least one safe negative check, such as self-review rejection or duplicate command replay;
- executed tests, coverage, and a conclusion that is separate from raw observations.

Do not reset the rollout database to repair a failed acceptance. Reject the affected Submission with a recovery note, fix it on the same Work Item branch, and resubmit current Git evidence.

## Operator verification

The operator can verify both isolated instances without reading Account tokens:

```bash
curl --fail --silent --show-error "http://100.64.0.5:8088/health"
curl --fail --silent --show-error "http://100.64.0.5:8089/health"
```

The 8088 dashboard must remain Completed while the 8089 dashboard advances independently. Account files and `.env` on the server must remain mode `600`.
