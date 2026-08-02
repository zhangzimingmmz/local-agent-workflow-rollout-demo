#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function usage() {
  return `Usage: workflow <command> [arguments]

Commands:
  whoami
  list
  show <work-item-id>
  status <work-item-id>
  claim <work-item-id>
  start <work-item-id>
  policy <work-item-id>
  submit <work-item-id> --pr <url> --artifact <kind:path> [--artifact <kind:path> ...]
  review <work-item-id> --accept|--reject --note <text>

Environment:
  TEAM_WORKFLOW_URL
  TEAM_WORKFLOW_TOKEN
  TEAM_WORKFLOW_WORKSTATION_ID
  TEAM_WORKFLOW_SESSION_ID
  TEAM_WORKFLOW_BASE_BRANCH (optional, default: main)`
}

function configuration() {
  const url = process.env.TEAM_WORKFLOW_URL?.replace(/\/$/, '')
  const token = process.env.TEAM_WORKFLOW_TOKEN
  const workstationId = process.env.TEAM_WORKFLOW_WORKSTATION_ID
  const sessionId = process.env.TEAM_WORKFLOW_SESSION_ID
  if (!url) throw new Error('TEAM_WORKFLOW_URL is required')
  if (!token) throw new Error('TEAM_WORKFLOW_TOKEN is required')
  if (!workstationId) throw new Error('TEAM_WORKFLOW_WORKSTATION_ID is required')
  if (!sessionId) throw new Error('TEAM_WORKFLOW_SESSION_ID is required')
  return { url, token, workstationId, sessionId, baseBranch: process.env.TEAM_WORKFLOW_BASE_BRANCH || 'main' }
}

async function request(path, options = {}) {
  const config = configuration()
  const response = await fetch(`${config.url}${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${config.token}`,
      'x-workflow-agent-type': 'codex',
      'x-workflow-workstation-id': config.workstationId,
      'x-workflow-session-id': config.sessionId,
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { message: text } }
  if (!response.ok) {
    const error = new Error(`${data.error || 'HTTP_ERROR'}: ${data.message || response.statusText}`)
    error.status = response.status
    throw error
  }
  return data
}

function idempotencyKey(command, id, payload = {}) {
  const input = JSON.stringify({ command, id, payload, sessionId: configuration().sessionId })
  const operation = createHash('sha256').update(input).digest('hex').slice(0, 24)
  return `workflow:${command}:${id}:${operation}`
}

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    throw new Error(`Git command failed: git ${args.join(' ')}\n${error.stderr?.trim() || error.message}`)
  }
}

function repositoryFromRemote(remote) {
  const https = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  const repository = https?.[1] || ssh?.[1]
  if (!repository) throw new Error('origin must be an HTTPS or SSH GitHub repository')
  return repository
}

function optionValues(args, name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`)
    values.push(args[index + 1])
    index += 1
  }
  return values
}

function oneOption(args, name) {
  const values = optionValues(args, name)
  if (values.length !== 1) throw new Error(`${name} must be provided exactly once`)
  return values[0]
}

function artifact(value) {
  const separator = value.indexOf(':')
  if (separator < 1 || separator === value.length - 1) throw new Error(`Invalid artifact ${value}; expected <kind:path>`)
  return { kind: value.slice(0, separator), path: value.slice(separator + 1) }
}

async function run(argv) {
  const [command, id, ...args] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  let result
  if (command === 'whoami') result = await request('/api/v1/me')
  else if (command === 'list') result = await request('/api/v1/tasks')
  else if (command === 'show' || command === 'status') {
    if (!id) throw new Error(`${command} requires a work item ID`)
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}`)
  } else if (command === 'policy') {
    if (!id) throw new Error('policy requires a work item ID')
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}/guidance`)
  } else if (command === 'claim') {
    if (!id) throw new Error('claim requires a work item ID')
    const body = {}
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}/claim`, {
      method: 'POST', body, idempotencyKey: idempotencyKey(command, id, body)
    })
  } else if (command === 'start') {
    if (!id) throw new Error('start requires a work item ID')
    const body = {
      agentType: 'codex',
      repository: repositoryFromRemote(git('config', '--get', 'remote.origin.url')),
      branch: git('branch', '--show-current')
    }
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}/start`, {
      method: 'POST', body, idempotencyKey: idempotencyKey(command, id, body)
    })
  } else if (command === 'submit') {
    if (!id) throw new Error('submit requires a work item ID')
    const config = configuration()
    const artifacts = optionValues(args, '--artifact').map(artifact)
    if (artifacts.length === 0) throw new Error('submit requires at least one --artifact <kind:path>')
    const body = {
      repository: repositoryFromRemote(git('config', '--get', 'remote.origin.url')),
      baseBranch: config.baseBranch,
      branch: git('branch', '--show-current'),
      commitSha: git('rev-parse', 'HEAD'),
      pullRequestUrl: oneOption(args, '--pr'),
      artifacts
    }
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}/submit`, {
      method: 'POST', body, idempotencyKey: idempotencyKey(command, id, body)
    })
  } else if (command === 'review') {
    if (!id) throw new Error('review requires a work item ID')
    const accept = args.includes('--accept')
    const reject = args.includes('--reject')
    if (accept === reject) throw new Error('review requires exactly one of --accept or --reject')
    const body = { decision: accept ? 'accept' : 'reject', note: oneOption(args, '--note') }
    result = await request(`/api/v1/tasks/${encodeURIComponent(id)}/review`, {
      method: 'POST', body, idempotencyKey: idempotencyKey(command, id, body)
    })
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`)
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

run(process.argv.slice(2)).catch((error) => fail(error.message))
