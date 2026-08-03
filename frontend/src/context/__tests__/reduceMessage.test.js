import { describe, it, expect } from 'vitest'
import { reduceMessage } from '../AssistantContext.jsx'

/**
 * reduceMessage is the single implementation shared by the live SSE stream and
 * the replay of a stored run. That sharing is the whole point: if the two ever
 * diverged, an answer would render differently after a reload than it did while
 * it was being produced, and nothing would fail loudly.
 *
 * So these tests do two things — check each event type in isolation, and check
 * that folding a whole event log produces the same result as applying it live.
 */

const empty = () => ({ role: 'assistant', content: '', tools: [] })
const fold = (events, start = empty()) => events.reduce(reduceMessage, start)

describe('tokens', () => {
  it('accumulates streamed text in order', () => {
    const m = fold([
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ', ' },
      { type: 'token', text: 'world' },
    ])
    expect(m.content).toBe('Hello, world')
  })

  it('treats a missing content field as empty rather than "undefined"', () => {
    const m = reduceMessage({ role: 'assistant' }, { type: 'token', text: 'hi' })
    expect(m.content).toBe('hi')
  })
})

describe('tool calls', () => {
  it('matches a result to its call by toolUseId', () => {
    const m = fold([
      { type: 'tool', name: 'list_todos', toolUseId: 'a1' },
      { type: 'tool', name: 'log_habit', toolUseId: 'b2' },
      { type: 'tool_result', toolUseId: 'b2', status: 'success', input: '{"id":3}', output: 'ok' },
    ])
    expect(m.tools).toHaveLength(2)
    expect(m.tools[0]).toMatchObject({ name: 'list_todos' })
    expect(m.tools[0].status).toBeUndefined()
    expect(m.tools[1]).toMatchObject({ name: 'log_habit', status: 'success', output: 'ok' })
  })

  it('keeps the same tool called twice as two separate entries', () => {
    const m = fold([
      { type: 'tool', name: 'add_todo', toolUseId: 'x1' },
      { type: 'tool', name: 'add_todo', toolUseId: 'x2' },
      { type: 'tool_result', toolUseId: 'x1', status: 'success', output: 'first' },
      { type: 'tool_result', toolUseId: 'x2', status: 'error', output: 'second' },
    ])
    expect(m.tools.map(t => t.output)).toEqual(['first', 'second'])
  })

  it('ignores a result for a call it never saw', () => {
    const m = fold([{ type: 'tool_result', toolUseId: 'ghost', status: 'success' }])
    expect(m.tools).toEqual([])
  })
})

describe('research lifecycle', () => {
  const plan = { type: 'research_plan', objectives: ['ferries', 'hotels'] }

  it('creates one running researcher per objective', () => {
    const m = fold([plan])
    expect(m.research).toEqual([
      { objective: 'ferries', status: 'running' },
      { objective: 'hotels', status: 'running' },
    ])
  })

  it('appends activity to the right researcher only', () => {
    const m = fold([
      plan,
      { type: 'research_activity', index: 1, tool: 'tavily_search', detail: 'hotels galway', status: 'success' },
    ])
    expect(m.research[0].activity).toBeUndefined()
    expect(m.research[1].activity).toHaveLength(1)
  })

  it('caps activity so a long run cannot grow without bound', () => {
    const events = [plan]
    for (let i = 0; i < 30; i++) {
      events.push({ type: 'research_activity', index: 0, tool: `t${i}`, status: 'success' })
    }
    const m = fold(events)
    expect(m.research[0].activity).toHaveLength(20)
    // The cap must keep the most recent, not the oldest.
    expect(m.research[0].activity.at(-1).tool).toBe('t29')
  })

  it('clears activity on retry so the second attempt starts clean', () => {
    const m = fold([
      plan,
      { type: 'research_activity', index: 0, tool: 'tavily_search', status: 'error' },
      { type: 'research_retry', index: 0, detail: 'context exhausted' },
    ])
    expect(m.research[0]).toMatchObject({ status: 'running', retried: true })
    expect(m.research[0].activity).toEqual([])
  })

  it('drops activity on completion and keeps the summary', () => {
    const m = fold([
      plan,
      { type: 'research_activity', index: 0, tool: 'tavily_search', status: 'success' },
      { type: 'research_done', index: 0, status: 'ok', summary: 'Ferries run twice daily.' },
    ])
    expect(m.research[0].status).toBe('ok')
    expect(m.research[0].summary).toBe('Ferries run twice daily.')
    expect(m.research[0].activity).toBeUndefined()
  })

  it('records a failure without inventing a summary', () => {
    const m = fold([plan, { type: 'research_done', index: 1, status: 'failed', detail: 'timed out' }])
    expect(m.research[1].status).toBe('failed')
    expect(m.research[1].summary).toBeUndefined()
  })
})

describe('questions', () => {
  const ask = { type: 'question', questionId: 'q1', question: 'Which repo?', options: ['atlas', 'other'] }

  it('opens a question with its options', () => {
    const m = fold([ask])
    expect(m.question).toEqual({ id: 'q1', text: 'Which repo?', options: ['atlas', 'other'], status: 'open' })
  })

  it('defaults options to an empty list', () => {
    const m = fold([{ type: 'question', questionId: 'q2', question: 'Why?' }])
    expect(m.question.options).toEqual([])
  })

  it('records the answer', () => {
    const m = fold([ask, { type: 'question_answered', questionId: 'q1', answer: 'atlas' }])
    expect(m.question).toMatchObject({ status: 'answered', answer: 'atlas' })
  })

  it('marks a timeout', () => {
    const m = fold([ask, { type: 'question_timeout', questionId: 'q1' }])
    expect(m.question.status).toBe('timeout')
  })

  it('ignores an answer for a different question', () => {
    const m = fold([ask, { type: 'question_answered', questionId: 'other', answer: 'x' }])
    expect(m.question.status).toBe('open')
  })
})

describe('coding lifecycle', () => {
  const start = { type: 'coding_started', repo: 'willwoodward/atlas', branch: 'atlas/add-tests', task: 'Add tests' }

  it('starts a run with empty activity and commits', () => {
    const m = fold([start])
    expect(m.coding).toMatchObject({ branch: 'atlas/add-tests', status: 'running', activity: [], commits: [] })
  })

  it('ignores coding events with no run started', () => {
    const m = fold([{ type: 'coding_activity', tool: 'sandbox_bash', status: 'success' }])
    expect(m.coding).toBeUndefined()
  })

  it('records commits, and keeps failed ones flagged', () => {
    // A commit that could not be saved must stay visible: an agent unable to
    // save its work looks identical to one that never tried.
    const m = fold([
      start,
      { type: 'coding_commit', sha: 'abc1234', message: 'Add vitest', files: 3, committed: true },
      { type: 'coding_commit', message: 'Add tests', committed: false, error: 'dubious ownership' },
    ])
    expect(m.coding.commits).toHaveLength(2)
    expect(m.coding.commits[0]).toMatchObject({ sha: 'abc1234', files: 3, failed: false })
    expect(m.coding.commits[1]).toMatchObject({ failed: true, error: 'dubious ownership' })
  })

  it('caps activity but never caps commits', () => {
    const events = [start]
    for (let i = 0; i < 40; i++) {
      events.push({ type: 'coding_activity', tool: `t${i}`, status: 'success' })
      events.push({ type: 'coding_commit', sha: `sha${i}`, message: `c${i}`, files: 1, committed: true })
    }
    const m = fold(events)
    expect(m.coding.activity).toHaveLength(30)
    expect(m.coding.commits).toHaveLength(40)
  })

  it('keeps the PR url and summary when done, and drops activity', () => {
    const m = fold([
      start,
      { type: 'coding_activity', tool: 'sandbox_bash', status: 'success' },
      { type: 'coding_done', status: 'ok', branch: 'atlas/add-tests',
        pr_url: 'https://github.com/willwoodward/atlas/pull/7', summary: 'Added vitest.' },
    ])
    expect(m.coding.status).toBe('ok')
    expect(m.coding.prUrl).toBe('https://github.com/willwoodward/atlas/pull/7')
    expect(m.coding.activity).toBeUndefined()
  })

  it('preserves commits through a failed run — the work is still on the branch', () => {
    const m = fold([
      start,
      { type: 'coding_commit', sha: 'abc1234', message: 'Partial work', files: 2, committed: true },
      { type: 'coding_done', status: 'timeout', branch: 'atlas/add-tests', summary: 'Ran out of time.' },
    ])
    expect(m.coding.status).toBe('timeout')
    expect(m.coding.commits).toHaveLength(1)
  })
})

describe('unknown events', () => {
  it('passes the message through untouched', () => {
    const before = fold([{ type: 'token', text: 'hi' }])
    const after = reduceMessage(before, { type: 'something_new_from_a_later_version' })
    expect(after).toEqual(before)
  })
})

describe('live and replay agree', () => {
  // The property that matters: replaying a stored log must land on the same
  // state the live stream produced, because that is what the UI does after a
  // reload. Content is stored in full and tokens are skipped on replay, so the
  // replay path is the non-token events folded onto the stored content.
  const log = [
    { type: 'coding_started', repo: 'willwoodward/atlas', branch: 'atlas/x', task: 't' },
    { type: 'tool', name: 'delegate_coding', toolUseId: 'd1' },
    { type: 'coding_commit', sha: 'aaa1111', message: 'Add tests', files: 4, committed: true },
    { type: 'token', text: 'Opened ' },
    { type: 'coding_done', status: 'ok', branch: 'atlas/x', pr_url: 'https://example.com/pr/1', summary: 's' },
    { type: 'token', text: 'a PR.' },
    { type: 'tool_result', toolUseId: 'd1', status: 'success', output: 'done' },
  ]

  it('produces identical state either way', () => {
    const live = fold(log)

    const stored = { role: 'assistant', content: live.content, tools: [], research: undefined }
    const replayed = fold(log.filter(e => e.type !== 'token'), stored)

    expect(replayed.content).toBe(live.content)
    expect(replayed.tools).toEqual(live.tools)
    expect(replayed.coding).toEqual(live.coding)
  })
})
