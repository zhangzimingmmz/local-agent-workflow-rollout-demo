import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import test from 'node:test'

const skillUrl = new URL('../deliverables/dev-002/team-workflow/SKILL.md', import.meta.url)
const cliUrl = new URL('../deliverables/dev-002/team-workflow/workflow.mjs', import.meta.url)
const projectSkillUrl = new URL('../.agents/skills/team-workflow/SKILL.md', import.meta.url)
const projectCliUrl = new URL('../.agents/skills/team-workflow/scripts/workflow.mjs', import.meta.url)
const runFile = promisify(execFile)

test('DEV-002 packages Codex Skill instructions and a deterministic CLI', async () => {
  const [skill, cli] = await Promise.all([readFile(skillUrl, 'utf8'), readFile(cliUrl, 'utf8')])
  assert.match(skill, /Organization.*Team.*Project.*Module.*Work Item/s)
  assert.match(skill, /claim.*policy.*start.*submit.*review/s)
  assert.match(cli, /idempotency-key/)
  assert.match(cli, /whoami/)
  assert.match(cli, /submit/)
  assert.doesNotMatch(cli, /update\((?:config\.)?token\)/)
  execFileSync(process.execPath, ['--check', cliUrl.pathname])
})

test('a fresh Codex checkout discovers the executable team-workflow Skill', async () => {
  const [skill, cli] = await Promise.all([
    readFile(projectSkillUrl, 'utf8'),
    readFile(projectCliUrl, 'utf8')
  ])
  assert.match(skill, /disable-model-invocation: true/)
  assert.match(skill, /scripts\/workflow\.mjs/)
  assert.match(skill, /explicit approval immediately before pushing/)
  assert.match(cli, /TEAM_WORKFLOW_URL/)
  assert.match(cli, /TEAM_WORKFLOW_WORKSTATION_ID/)
  assert.match(cli, /TEAM_WORKFLOW_SESSION_ID/)
  assert.match(cli, /idempotency-key/)
  execFileSync(process.execPath, ['--check', projectCliUrl.pathname])
})

test('project CLI audits repeatable Requirement evidence and fails closed on incomplete work', async (t) => {
  const dashboard = {
    requirements: [{ id: 'REQ-001', status: 'completed' }],
    tasks: [{
      id: 'DES-001', requirementId: 'REQ-001', status: 'integrated',
      ownerId: 'alice', reviewerId: 'bob', mergeSha: 'merge-sha',
      evidence: {
        verified: true, commitSha: 'a'.repeat(40),
        pullRequestUrl: 'https://github.com/acme/workflow/pull/1',
        artifacts: [{ kind: 'design', path: 'deliverables/design.md' }]
      }
    }],
    agentRuns: [{
      id: 'run-1', taskId: 'DES-001', actorId: 'alice',
      agentSessionId: 'session-owner', workstationId: 'workstation-a',
      guidanceSnapshot: {
        sources: ['organization', 'team', 'project', 'module', 'work_item'].map((scope) => ({ scope, version: 1 })),
        snapshotHash: 'guidance-hash'
      }
    }],
    agentSessions: [
      { sessionId: 'session-owner', actorId: 'alice', workstationId: 'workstation-a', agentType: 'codex', actions: 3 },
      { sessionId: 'session-reviewer', actorId: 'bob', workstationId: 'workstation-b', agentType: 'codex', actions: 1 }
    ],
    events: [
      { id: 'evt-1', type: 'TaskSubmitted', requirementId: 'REQ-001', taskId: 'DES-001', actorId: 'alice', agentSessionId: 'session-owner', occurredAt: '2026-08-03T00:00:01.000Z' },
      { id: 'evt-2', type: 'TaskAccepted', requirementId: 'REQ-001', taskId: 'DES-001', actorId: 'bob', agentSessionId: 'session-reviewer', occurredAt: '2026-08-03T00:00:02.000Z' },
      { id: 'evt-3', type: 'TaskIntegrated', requirementId: 'REQ-001', taskId: 'DES-001', actorId: 'github', occurredAt: '2026-08-03T00:00:03.000Z' }
    ]
  }
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(dashboard))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const environment = {
    ...process.env,
    TEAM_WORKFLOW_URL: `http://127.0.0.1:${server.address().port}`,
    TEAM_WORKFLOW_TOKEN: 'audit-token',
    TEAM_WORKFLOW_WORKSTATION_ID: 'workstation-a',
    TEAM_WORKFLOW_SESSION_ID: 'session-auditor'
  }
  const command = [
    projectCliUrl.pathname, 'audit', 'REQ-001',
    '--accounts', 'alice,bob',
    '--workstations', 'workstation-a,workstation-b',
    '--min-sessions', '2'
  ]

  const success = await runFile(process.execPath, command, { env: environment })
  const evidence = JSON.parse(success.stdout)
  assert.equal(evidence.passed, true)
  assert.deepEqual(evidence.observed, {
    requirementStatus: 'completed', workItems: 1, integratedWorkItems: 1,
    agentRuns: 1, agentSessions: 2, accounts: ['alice', 'bob'],
    workstations: ['workstation-a', 'workstation-b'], events: 3
  })
  assert.equal(evidence.workItems[0].pullRequestUrl, 'https://github.com/acme/workflow/pull/1')
  assert.deepEqual(evidence.failures, [])
  assert.match(await readFile(projectSkillUrl, 'utf8'), /audit <requirement-id>/)

  dashboard.requirements[0].status = 'in_progress'
  dashboard.tasks[0].status = 'submitted'
  await assert.rejects(
    runFile(process.execPath, command, { env: environment }),
    (error) => {
      const failed = JSON.parse(error.stdout)
      return error.code === 2
        && failed.passed === false
        && failed.failures.some((failure) => /Requirement REQ-001 is in_progress/.test(failure))
        && failed.failures.some((failure) => /DES-001 is submitted/.test(failure))
    }
  )

  dashboard.requirements[0].status = 'completed'
  dashboard.tasks[0].status = 'integrated'
  dashboard.events.reverse()
  const mismatchedCommand = [
    projectCliUrl.pathname, 'audit', 'REQ-001',
    '--accounts', 'alice,carol',
    '--workstations', 'workstation-a',
    '--min-sessions', '3'
  ]
  await assert.rejects(
    runFile(process.execPath, mismatchedCommand, { env: environment }),
    (error) => {
      const failed = JSON.parse(error.stdout)
      return error.code === 2
        && failed.failures.some((failure) => /Observed Accounts alice,bob do not match alice,carol/.test(failure))
        && failed.failures.some((failure) => /Observed Workstations workstation-a,workstation-b do not match workstation-a/.test(failure))
        && failed.failures.some((failure) => /at least 3 are required/.test(failure))
        && failed.failures.includes('Activity Events are not in chronological order')
    }
  )

  dashboard.events.reverse()
  dashboard.tasks[0].evidence.verified = false
  dashboard.tasks[0].mergeSha = null
  dashboard.agentRuns = []
  dashboard.events = []
  await assert.rejects(
    runFile(process.execPath, [projectCliUrl.pathname, 'audit', 'REQ-001'], { env: environment }),
    (error) => {
      const failed = JSON.parse(error.stdout)
      return error.code === 2
        && failed.failures.some((failure) => /no verified Git Evidence/.test(failure))
        && failed.failures.some((failure) => /no verified merge SHA/.test(failure))
        && failed.failures.some((failure) => /no Agent Run/.test(failure))
        && failed.failures.some((failure) => /missing organization guidance/.test(failure))
        && failed.failures.some((failure) => /missing TaskSubmitted/.test(failure))
    }
  )

  dashboard.requirements = []
  dashboard.tasks = []
  await assert.rejects(
    runFile(process.execPath, [projectCliUrl.pathname, 'audit', 'REQ-404'], { env: environment }),
    (error) => {
      const failed = JSON.parse(error.stdout)
      return error.code === 2
        && failed.observed.requirementStatus === null
        && failed.failures.includes('Requirement REQ-404 was not found')
        && failed.failures.includes('Requirement REQ-404 has no Work Items')
    }
  )

  await assert.rejects(
    runFile(process.execPath, [projectCliUrl.pathname, 'audit'], { env: environment }),
    (error) => error.code === 1 && /audit requires a Requirement ID/.test(error.stderr)
  )
  await assert.rejects(
    runFile(process.execPath, [projectCliUrl.pathname, 'audit', 'REQ-001', '--min-sessions', '-1'], { env: environment }),
    (error) => error.code === 1 && /--min-sessions must be a non-negative integer/.test(error.stderr)
  )
  await assert.rejects(
    runFile(process.execPath, [
      projectCliUrl.pathname, 'audit', 'REQ-001', '--accounts', 'alice', '--accounts', 'bob'
    ], { env: environment }),
    (error) => error.code === 1 && /--accounts may be provided at most once/.test(error.stderr)
  )
})
