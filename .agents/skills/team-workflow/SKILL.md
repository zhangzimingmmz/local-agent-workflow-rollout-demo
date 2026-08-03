---
name: team-workflow
description: Claim, execute, submit, review, and audit tracked work in the local-agent collaborative delivery PoC.
disable-model-invocation: true
---

# Team Workflow

Act for the authenticated human Account. The central control plane owns workflow state; GitHub owns Artifacts and Git Evidence. Never treat local completion as Acceptance or Integration.

Use the deterministic client at `scripts/workflow.mjs`, resolved relative to this Skill directory. Do not reproduce its HTTP calls manually when the script supports the operation.

## Preconditions

Require these environment variables without printing their values:

- `TEAM_WORKFLOW_URL`: Tailscale URL of the control plane, without a trailing slash.
- `TEAM_WORKFLOW_TOKEN`: token for the current virtual Account.
- `TEAM_WORKFLOW_WORKSTATION_ID`: opaque Workstation ID assigned to this Account.
- `TEAM_WORKFLOW_SESSION_ID`: a new opaque ID generated immediately before this fresh Codex session.
- `TEAM_WORKFLOW_BASE_BRANCH`: optional GitHub base branch; defaults to `main`.

Never persist `TEAM_WORKFLOW_SESSION_ID` in an Account file or repository, and never reuse it after closing or switching the Codex session. Do not report a hostname, username, hardware identifier, prompt, or model transcript; the opaque IDs are sufficient execution evidence.

Require a Git repository connected to the configured public GitHub project. Preserve unrelated local changes and never reset, clean, or overwrite them.

## Enter the workflow

1. Run `whoami`, confirm its Workstation matches `TEAM_WORKFLOW_WORKSTATION_ID`, then run `list`.
2. Select only a Work Item eligible for the authenticated role. If the user named an ID, run `show <id>` before changing anything.
3. Run `claim <id>`. Stop if it is blocked, already claimed, or rejected for the current role.
4. Run `policy <id>`. Treat the returned rules and source versions as the Effective Guidance for this Agent Run.
5. Confirm the current repository and inspect `git status --short`. Create or switch to `work/<work-item-id>-<slug>` only when doing so preserves existing changes.
6. Run `start <id>` immediately before producing the Artifact. The client reports the current repository and branch; the control plane records a Codex Agent Run with the server-resolved guidance snapshot.

Do not claim multiple Work Items speculatively. A claim makes the human Account the single Accountable Owner.

## Perform role work

### Designer

Produce versioned Markdown Artifacts that state the problem, solution, risks, boundaries, and executable acceptance scenarios required by Effective Guidance. Keep decisions reviewable in the repository rather than only in conversation.

### Developer

Use test-driven development for behavior changes. Keep implementation, migrations, tests, and validation evidence together on the Work Item branch. Do not broaden the task to unrelated cleanup.

### Tester

Verify the accepted design and development evidence independently. Store test cases, automated results, and a report in Git. Separate observed evidence from conclusions; do not silently repair production code unless the Work Item explicitly assigns that work.

### Reviewer

Inspect the Work Item, Effective Guidance, pull-request diff, checks, and declared Artifact paths. Use `review <id> --accept --note <text>` only when the Submission satisfies them. Otherwise use `--reject` with a concrete recovery note. Never review work owned by the same Account.

## Submit owner work

1. Run all checks required by Effective Guidance.
2. Inspect `git diff` and `git status --short`; ensure each declared Artifact is tracked.
3. Commit only the Work Item scope.
4. Ask the human for explicit approval immediately before pushing the branch or creating the pull request.
5. Push the branch and create a pull request targeting the configured base branch.
6. Run:

   ```text
   submit <id> --pr <pull-request-url> --artifact <kind:path> [--artifact <kind:path> ...]
   ```

The client infers repository, branch, and commit SHA from Git. If inference disagrees with the pull request, stop and repair the branch or PR instead of overriding evidence.

After submission, report the Work Item as Submitted. Do not call it Accepted, Integrated, or Done. A different Reviewer must accept it, and a verified GitHub merge must integrate it.

## Audit Requirement evidence

After the Requirement is expected to be complete, run the read-only audit with the rollout's configured expectations:

```text
audit <requirement-id> --accounts <id,id> --workstations <id,id> --min-sessions <count>
```

Treat `passed: true` as a deterministic evidence check, not a substitute for human workstation operation. Preserve the JSON output as a Git Artifact when the Work Item requires an acceptance report. On `passed: false`, use `failures` to repair the real workflow or evidence; never edit the audit output to manufacture a pass.

## Recover safely

- `401`: verify the local token belongs to the intended virtual Account; do not display it.
- `ROLE_MISMATCH`, `NOT_OWNER`, or `NOT_REVIEWER`: stop and report the identity/assignment mismatch.
- `WORKSTATION_MISMATCH` or `AGENT_SESSION_CONFLICT`: stop; confirm the Account file, assigned Workstation, and fresh session ID instead of bypassing the binding.
- `INVALID_STATE`: run `show <id>` and follow the returned current state; do not force a transition.
- `INVALID_EVIDENCE`: fix the branch, commit, PR, or Artifact paths in GitHub, then submit again.
- Network failure: preserve local work and retry the same command in the same Agent Session. The client derives a stable idempotency key from non-secret command inputs plus the Agent Session ID, and the server scopes it to the authenticated Account, so an identical retry cannot duplicate the state change or event while a later fresh session remains distinct. Do not claim a replacement Work Item.
- `IDEMPOTENCY_CONFLICT`: do not invent a new key to force the operation. Run `show <id>`, confirm the inputs and current state, then correct the command.

## Command reference

Run `node "<skill-directory>/scripts/workflow.mjs" --help` for exact syntax. The client outputs JSON so results remain inspectable and scriptable.
