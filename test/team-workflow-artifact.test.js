import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const skillUrl = new URL('../deliverables/dev-002/team-workflow/SKILL.md', import.meta.url)
const cliUrl = new URL('../deliverables/dev-002/team-workflow/workflow.mjs', import.meta.url)
const projectSkillUrl = new URL('../.agents/skills/team-workflow/SKILL.md', import.meta.url)
const projectCliUrl = new URL('../.agents/skills/team-workflow/scripts/workflow.mjs', import.meta.url)

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
