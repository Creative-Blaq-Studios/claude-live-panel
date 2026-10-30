import type { Ask, AskOption, AskQuestion, Call, Feed, Kind, Plan, Step, StepStatus, SummaryKind } from '../types'

export const EMPTY_PLAN: Plan = { title: '', steps: [], source: '', updatedAt: 0 }
export const EMPTY_FEED: Feed = { path: '', title: '', steps: [], updatedAt: 0 }

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

export function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`
}

/** "12s", "4m 05s", "1h 02m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** A stopwatch reading: "4:23", "18:40", "1:02:05". */
export function clockTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return s < 3600 ? `${mm}:${ss}` : `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}`
}

/** How long the session has run, to the minute: "0m", "14m", "2h 31m", "1d 03h". */
export function sessionLength(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`

  return `${Math.floor(m / 1440)}d ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}h`
}

/** "Session · started 09:14 · 2h 31m", with the date when the session began on another day. */
export function sessionLine(startedAt: number, now: number): string {
  const start = new Date(startedAt)
  const day = start.toDateString() === new Date(now).toDateString() ? '' : `${start.toDateString().slice(4, 10)}, `
  return `Session · started ${day}${start.toTimeString().slice(0, 5)} · ${sessionLength(now - startedAt)}`
}

const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** What a tool call is doing, in plain words, and which lane of the timeline it sits in. */
export function classify(tool: string, input: Record<string, unknown>): { kind: Kind; label: string; detail: string } {
  const desc = str(input.description)
  const file = str(input.file_path) || str(input.notebook_path) || str(input.path)
  if (tool === 'Read') return { kind: 'read', label: 'Reading a file', detail: base(file) }
  if (tool === 'Write') return { kind: 'edit', label: 'Creating a file', detail: base(file) }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return { kind: 'edit', label: 'Editing a file', detail: base(file) }
  if (tool === 'Bash') return { kind: 'run', label: 'Running a command', detail: desc || str(input.command) }
  if (tool === 'Grep' || tool === 'Glob') return { kind: 'search', label: 'Searching the code', detail: str(input.pattern) }
  if (tool === 'WebSearch') return { kind: 'web', label: 'Searching the web', detail: str(input.query) }
  if (tool === 'WebFetch') return { kind: 'web', label: 'Reading a web page', detail: str(input.url) }
  if (tool === 'Agent' || tool === 'Task') return { kind: 'agent', label: 'Helper agent working', detail: desc || str(input.subagent_type) }
  if (tool === 'AskUserQuestion') return { kind: 'you', label: 'Asking you a question', detail: '' }
  if (tool === 'Monitor') return { kind: 'run', label: 'Watching a background job', detail: desc }
  if (tool === 'Skill') return { kind: 'read', label: 'Loading a skill', detail: str(input.skill) }
  if (tool === 'ToolSearch') return { kind: 'read', label: 'Loading tools', detail: '' }
  if (isPlanTool(tool) || tool === 'mcp__ccd_turn__wrap_up') return { kind: 'plan', label: 'Updating the plan', detail: '' }
  if (tool.startsWith('mcp__Claude_Browser__') || tool.startsWith('mcp__claude-in-chrome__')) {
    return { kind: 'web', label: 'Using the browser', detail: str(input.url) || str(input.action) }
  }
  if (tool.startsWith('mcp__computer-use__')) return { kind: 'run', label: 'Using your computer', detail: str(input.app) }
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__')
    return { kind: 'other', label: `Using ${parts[1] ?? 'a connector'}`, detail: (parts[2] ?? '').replace(/_/g, ' ') }
  }

  return { kind: 'other', label: tool, detail: desc }
}

export function isPlanTool(tool: string): boolean {
  return tool === 'mcp__ccd_turn__update_plan' || tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate'
}

export function toStatus(v: unknown): StepStatus {
  const s = str(v).toLowerCase()
  if (s === 'completed' || s === 'done' || s === 'passed' || s === 'complete') return 'done'
  if (s === 'in_progress' || s === 'active' || s === 'running' || s === 'retrying') return 'active'
  if (s === 'failed' || s === 'error') return 'failed'

  return 'pending'
}

function setStatus(steps: Step[], index: number, status: StepStatus): void {
  const step = steps[index]
  if (step) steps[index] = { ...step, status }
}

/** The plan after one of Claude's plan tools ran, or undefined when the call was not a plan change. */
export function planFromTool(tool: string, input: Record<string, unknown>, prev: Plan, now: number): Plan | undefined {
  let steps: Step[] | undefined
  if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) {
      steps = input.items.map(item => {
        const it = (item ?? {}) as Record<string, unknown>
        return { title: str(it.content), status: toStatus(it.status) }
      })
    } else {
      steps = prev.steps.map(step => ({ ...step }))
      if (Array.isArray(input.done)) for (const n of input.done) if (typeof n === 'number') setStatus(steps, n - 1, 'done')
      if (typeof input.start === 'number') {
        steps.forEach((step, i) => step.status === 'active' && setStatus(steps!, i, 'pending'))
        setStatus(steps, input.start - 1, 'active')
      }
      if (input.advance === true) {
        const at = steps.findIndex(step => step.status === 'active')
        if (at >= 0) setStatus(steps, at, 'done')
        const nextAt = steps.findIndex((step, i) => i > at && step.status === 'pending')
        if (nextAt >= 0) setStatus(steps, nextAt, 'active')
      }
    }
  } else if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    steps = input.todos.map(item => {
      const it = (item ?? {}) as Record<string, unknown>
      return { title: str(it.content) || str(it.activeForm), status: toStatus(it.status) }
    })
  } else if (tool === 'TaskCreate') {
    const title = str(input.subject) || str(input.description)
    if (title) steps = [...prev.steps, { title, status: 'pending' }]
  } else if (tool === 'TaskUpdate') {
    const index = Number.parseInt(str(input.taskId), 10) - 1
    if (Number.isInteger(index) && prev.steps[index]) {
      steps = prev.steps.map(step => ({ ...step }))
      if (str(input.status) === 'deleted') steps.splice(index, 1)
      else if (input.status !== undefined) setStatus(steps, index, toStatus(input.status))
    }
  }
  if (steps === undefined) return undefined
  steps = steps.filter(step => step.title !== '')

  return { title: prev.title, steps: withTiming(steps, prev.steps, now), source: tool, updatedAt: now }
}

/** Carries each step's start and finish times across plan updates, matched by title. */
export function withTiming(steps: Step[], prev: Step[], now: number): Step[] {
  return steps.map(step => {
    const old = prev.find(one => one.title === step.title)
    const startedAt = old?.startedAt ?? (step.status !== 'pending' ? now : undefined)
    const doneAt = step.status === 'done' ? (old?.doneAt ?? now) : undefined
    const out: Step = { ...step }
    if (startedAt !== undefined) out.startedAt = startedAt
    if (doneAt !== undefined) out.doneAt = doneAt
    return out
  })
}

/** A rough "time left": the average finished step's length, times the steps still to go. */
export function timeLeft(steps: Step[], now: number): number | undefined {
  const timed = steps.filter(s => s.status === 'done' && s.startedAt !== undefined && s.doneAt !== undefined && s.doneAt > s.startedAt)
  if (timed.length === 0) return undefined
  const avg = timed.reduce((sum, s) => sum + (s.doneAt! - s.startedAt!), 0) / timed.length
  const pending = steps.filter(s => s.status === 'pending').length
  const active = steps.filter(s => s.status === 'active')
  const activeLeft = active.reduce((sum, s) => sum + Math.max(avg * 0.2, avg - (now - (s.startedAt ?? now))), 0)

  return pending * avg + activeLeft
}

export function parseFeed(path: string, text: string, now: number, prev: Step[]): Feed {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const steps = Array.isArray(data.steps)
      ? data.steps
          .map(item => {
            const it = (item ?? {}) as Record<string, unknown>
            const step: Step = { title: str(it.title), status: toStatus(it.status) }
            const note = str(it.note)
            if (note) step.note = note
            return step
          })
          .filter(step => step.title !== '')
      : []
    return { path, title: str(data.title) || base(path), steps: withTiming(steps, prev, now), updatedAt: now }
  } catch {
    return { path, title: base(path), steps: prev, error: 'the file is being rewritten', updatedAt: now }
  }
}

export function parseQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map(item => {
      const it = (item ?? {}) as Record<string, unknown>
      const options: AskOption[] = Array.isArray(it.options)
        ? it.options
            .map(o => {
              const op = (o ?? {}) as Record<string, unknown>
              const option: AskOption = { label: str(op.label) }
              const description = str(op.description)
              if (description) option.description = description
              return option
            })
            .filter(o => o.label !== '')
        : []
      const q: AskQuestion = { question: str(it.question), options, multiSelect: it.multiSelect === true }
      const header = str(it.header)
      if (header) q.header = header
      return q
    })
    .filter(q => q.question !== '')
}

/** The buttons of the desktop app's end-of-turn box, as a choice for the panel. */
export function choiceFromWrapUp(input: Record<string, unknown>, id: string, now: number): Ask | undefined {
  const question = str(input.ask)
  if (!question || !Array.isArray(input.actions)) return undefined
  const options: AskOption[] = input.actions
    .map(a => {
      const act = (a ?? {}) as Record<string, unknown>
      if (act.action !== undefined) return undefined
      const label = str(act.label)
      return label ? { label, message: str(act.message) || label } : undefined
    })
    .filter((o): o is { label: string; message: string } => o !== undefined)

  return { id, source: 'choice', questions: [{ question, options, multiSelect: false }], picks: [[]], at: now }
}

const YES_NO = /^(should|shall|do you|would you|want me|can i|may i|is it|are you|ok to|okay to)\b/i

/** When Claude's last message ends by asking something, a reply card for it. */
export function replyFromText(text: string, id: string, now: number): Ask | undefined {
  // Only the last paragraph, with code and links taken out, so a URL's "?" is not a question.
  const tail = (text.trim().split(/\n\s*\n/).pop() ?? '').replace(/`[^`]*`/g, ' ').replace(/\bhttps?:\/\/\S+/g, ' ')
  const sentences = tail.match(/[^.!?\n]*\?/g)
  const question = sentences?.pop()?.replace(/^[\s*_>#-]+/, '').trim()
  if (!question || question.split(/\s+/).length < 3 || !/^[A-Za-z"']/.test(question)) return undefined
  const options: AskOption[] = YES_NO.test(question)
    ? [{ label: 'Yes', message: 'Yes, go ahead.' }, { label: 'No', message: 'No, not now.' }]
    : []

  return { id, source: 'reply', questions: [{ question: clip(question, 240), options, multiSelect: false }], picks: [[]], at: now }
}

/** The message the panel sends for the answers picked. */
export function answerText(ask: Ask, typed?: string): string {
  if (typed !== undefined) {
    const only = ask.questions.length === 1 ? ask.questions[0] : undefined
    return only && ask.source === 'question' ? `Answer to "${only.question}": ${typed}` : typed
  }
  if (ask.source !== 'question') {
    const label = ask.picks[0]?.[0] ?? ''
    return ask.questions[0]?.options.find(o => o.label === label)?.message ?? label
  }

  return ask.questions.map((q, i) => `Answer to "${q.question}": ${(ask.picks[i] ?? []).join(', ') || '(no answer)'}`).join('\n')
}

/** Claude warm: clay for what is running now, sage for done, brick for failed, sand greys for waiting. */
export const PAL = { now: '#D97757', done: '#6B8F71', failed: '#C2453D', waiting: '#A39E93' }

export const LANES: { kind: Kind; label: string; color: string }[] = [
  { kind: 'read', label: 'Reading', color: '#6E7F8D' },
  { kind: 'search', label: 'Searching', color: '#8E6C8A' },
  { kind: 'edit', label: 'Editing', color: '#C9A24A' },
  { kind: 'run', label: 'Running', color: '#6B8F71' },
  { kind: 'web', label: 'Web', color: '#5E8C8A' },
  { kind: 'agent', label: 'Helpers', color: '#D97757' },
  { kind: 'you', label: 'Asking you', color: '#C2453D' },
  { kind: 'plan', label: 'Planning', color: '#A39E93' },
  { kind: 'other', label: 'Other', color: '#BDB7AC' },
]

export function running(calls: Call[]): Call[] {
  return calls.filter(c => c.endedAt === undefined)
}

/** The writing rules every recap follows: ASD-STE100 Simplified Technical English, plain characters only. */
export const STE_RULES =
  'Write in ASD-STE100 Simplified Technical English. Use simple, common words with one meaning each. ' +
  'Use the active voice. Keep each sentence to 20 words or fewer. Put one idea in each sentence. ' +
  'Use the imperative for instructions. Do not use em dashes, en dashes or semicolons. ' +
  'Use only plain ASCII characters and straight quotes. Use "- " only to start a bullet. No preamble and no closing line.'

/** What Claude is asked to write for each kind of copyable recap, for someone who was not watching. */
export const SUMMARY_PROMPTS: Record<SummaryKind, string> = {
  summary:
    'Write a summary of this session for a person who did not watch it. Start with one sentence that tells what ' +
    'was done and the status now. Then write up to 5 short bullets with the main results. Use fewer than 120 words. ' +
    STE_RULES,
  changes:
    'Write a list of the changes in this session. Write one short bullet for each file or item that was created, ' +
    'changed or deleted. Tell why in a few words. If there are more than 8 bullets, put them under short headings. ' +
    'If there are no changes, write one sentence that tells this. ' +
    STE_RULES,
  next:
    'Write a list of the work that is not done and the decisions that the user must make. Use short bullets and put ' +
    'the most important item first. End with one line that starts with "Recommended next step:". Use fewer than 120 words. ' +
    STE_RULES,
}

/** Makes a recap plain text: straight quotes, no em or en dashes, no special punctuation. */
export function steClean(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\s*[\u2014\u2015]\s*/g, ', ')
    .replace(/(\d)\s*\u2013\s*(\d)/g, '$1 to $2')
    .replace(/\s*\u2013\s*/g, ', ')
    .replace(/^(\s*)[\u2022\u25CF\u25E6\u2023]\s*/gm, '$1- ')
    .replace(/\s*;\s+([a-z])?/g, (_m, c: string | undefined) => `. ${c ? c.toUpperCase() : ''}`)
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
}

const DOING: Record<Kind, string> = {
  read: 'Reading the code',
  search: 'Searching the code',
  edit: 'Changing the code',
  run: 'Running a command',
  web: 'Researching online',
  agent: 'Helpers are working',
  you: 'Waiting for you',
  plan: 'Planning the work',
  other: 'Working',
}

/** What Claude is doing now, in a few plain words, from its latest action. Free and instant: no model call. */
export function nowDoing(calls: Call[]): string {
  const last = [...calls].reverse().find(c => !c.isHelper) ?? calls[calls.length - 1]
  if (!last) return 'Getting started'
  const what = `${last.detail} ${last.input ?? ''}`.toLowerCase()
  if (last.kind === 'run' && /\b(test|tests|jest|vitest|pytest|mocha|spec)\b/.test(what)) return 'Running the tests'
  if (last.kind === 'run' && /\b(tsc|typecheck|lint|eslint|build)\b/.test(what)) return 'Checking the code'
  if (last.kind === 'edit' && /(test|spec)/.test((last.target ?? last.detail).toLowerCase())) return 'Writing tests'

  return DOING[last.kind]
}

/** How a narration is written: a status line in Claude's own voice that a person can take in at a glance. */
export const NARRATE_SYSTEM =
  'You write the live status line for a person who watches an AI coding agent work. Write one or two short ' +
  'sentences in the first person, as the agent. Say what you are doing now, in plain words that a person who ' +
  'does not program understands. Name the feature or the part of the app, not files, commands, tools or code. ' +
  'If the next step is known, end with a short sentence that starts with "Next". Use fewer than 35 words. ' +
  'Use only plain ASCII characters. No preamble.'

/** What the narration is written from: the plan, the latest actions, and the last line, so it says what changed. */
export function narrationPrompt(plan: Plan, calls: Call[], previous: string): string {
  const steps = plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.title}`).join('\n')
  const recent = calls
    .filter(c => !c.isHelper)
    .slice(-12)
    .map(c => `- ${c.label}${c.detail ? `: ${clip(c.detail, 80)}` : ''}${c.isError ? ' (failed)' : ''}`)
    .join('\n')
  return (
    `Task: ${plan.title || 'not named'}\nPlan:\n${steps || '(no plan)'}\nLatest actions, oldest first:\n${recent || '(none)'}\n` +
    (previous ? `Your last status line was: "${previous}". Do not repeat it. Say what changed.` : '')
  )
}

/** What Claude is asked to write when a checkpoint is saved. */
export const CHECKPOINT_PROMPT =
  'Write a checkpoint for this session. First write one sentence that tells where the work stands now. ' +
  'Then write up to 5 short bullets with the work that was done in this section. ' +
  'End with one line that starts with "Continue with:" and tells the next step. Use fewer than 120 words. '

/** Tells Claude a decision is left open, so the checkpoint names it and does not make it. */
export function decisionNote(questions: AskQuestion[]): string {
  if (questions.length === 0) return ''
  const list = questions.map(q => `- ${q.question}${q.options.length ? ` (options: ${q.options.map(o => o.label).join('; ')})` : ''}`).join('\n')
  return (
    'The work now waits for a decision from the person, who will decide in a later session. Do not make the decision. ' +
    'Before the "Continue with:" line, write one line that starts with "Decide:" and names the decision and its options.\n' +
    `Open decisions:\n${list}\n`
  )
}

/** Tells Claude which part of the session to cover: only the work after the last checkpoint. */
export function sectionNote(last: { at: number; summary: string } | undefined, actions: Call[]): string {
  if (!last) return ''
  const time = new Date(last.at).toTimeString().slice(0, 5)
  const done = actions
    .slice(-30)
    .map(c => `- ${c.label}${c.detail ? `: ${clip(c.detail, 80)}` : ''}`)
    .join('\n')
  return (
    `Only cover the work after the last checkpoint, which was saved at ${time}. Do not repeat the work before it. ` +
    `That checkpoint said: "${clip(last.summary.replace(/\s+/g, ' '), 400)}". ` +
    (done ? `The actions after it were:\n${done}\n` : 'There were no recorded actions after it. ')
  )
}

export const SUMMARY_LABEL: Record<SummaryKind, string> = { summary: 'Summary', changes: 'What changed', next: "What's next" }
export const SUMMARY_KINDS: SummaryKind[] = ['summary', 'changes', 'next']

/** What an action was given, readable: the full command for a shell call, else its arguments. */
export function inputDetail(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash' && typeof input.command === 'string') return clip(input.command, 1500)
  const shown: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'tool' || key === 'tool_use_id' || key === 'agentId' || key === 'requestMeta' || key === 'consent') continue
    shown[key] = typeof value === 'string' && value.length > 600 ? `${value.slice(0, 600)}…` : value
  }
  try {
    return clip(JSON.stringify(shown, null, 2), 1500)
  } catch {
    return ''
  }
}

export type Tone = 'now' | 'failed' | 'done' | 'slow' | 'muted'
export type Health = { label: string; tone: Tone; note?: string }

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * One word for "is everything OK?", first match wins: Needs you, Failed,
 * Finished, Slow, On track, Working, Ready. A single failed action is a
 * retry note, not "Failed": Claude often recovers on its own.
 */
export function health(input: { hasAsk: boolean; isRunning: boolean; hadTurn: boolean; steps: Step[]; calls: Call[] }, now: number): Health {
  const main = input.calls.filter(c => !c.isHelper)
  const finished = main.filter(c => c.endedAt !== undefined)
  const recent = finished.slice(-10)
  const retries = recent.filter(c => c.isError).length
  const note = retries > 0 ? `${retries} retr${retries === 1 ? 'y' : 'ies'} recently` : undefined
  if (input.hasAsk) return { label: 'Needs you', tone: 'now' }
  const lastTwo = finished.slice(-2)
  if (input.steps.some(s => s.status === 'failed') || (lastTwo.length === 2 && lastTwo.every(c => c.isError))) {
    return { label: 'Failed', tone: 'failed', note: 'Claude may still recover; check the latest actions.' }
  }
  if (!input.isRunning) return input.hadTurn ? { label: 'Finished', tone: 'done' } : { label: 'Ready', tone: 'muted' }
  const current = [...main].reverse().find(c => c.endedAt === undefined)
  const sameKind = finished.filter(c => current && c.kind === current.kind).map(c => c.endedAt! - c.startedAt)
  if (current && sameKind.length >= 3) {
    const usual = median(sameKind)
    const sofar = now - current.startedAt
    if (sofar > 20_000 && sofar > 2 * usual) return { label: 'Slow', tone: 'slow', note: `${current.label} is taking longer than usual (${duration(usual)}).` }
    return { label: 'On track', tone: 'done', note }
  }
  return { label: 'Working', tone: 'muted', note }
}

export type Share = { kind: Kind; label: string; color: string; ms: number }

/** Where the last 10 minutes went, by kind of work. Anchored to the latest action, not the clock. */
export function activityShares(calls: Call[]): Share[] {
  const latest = calls.reduce((max, c) => Math.max(max, c.endedAt ?? c.startedAt), 0)
  const end = Math.ceil(latest / 5000) * 5000 + 5000
  const start = end - 10 * 60_000
  const sums = new Map<Kind, number>()
  for (const c of calls) {
    const from = Math.max(start, c.startedAt)
    const to = Math.min(end, c.endedAt ?? end)
    if (to > from) sums.set(c.kind, (sums.get(c.kind) ?? 0) + (to - from))
  }
  return LANES.filter(l => (sums.get(l.kind) ?? 0) > 0).map(l => ({ kind: l.kind, label: l.label, color: l.color, ms: sums.get(l.kind)! }))
}

export const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** A file Claude touched this session, for "Where Claude worked". */
export type Place = { path: string; name: string; creates: number; edits: number; reads: number; last: number }

/** The files Claude created, edited or read: changed ones first, newest first. */
export function places(calls: Call[]): Place[] {
  const byPath = new Map<string, Place>()
  for (const c of calls) {
    if (!c.target) continue
    const place = byPath.get(c.target) ?? { path: c.target, name: base(c.target), creates: 0, edits: 0, reads: 0, last: 0 }
    if (c.label === 'Creating a file') place.creates++
    else if (c.kind === 'edit') place.edits++
    else place.reads++
    place.last = Math.max(place.last, c.startedAt)
    byPath.set(c.target, place)
  }
  const changed = (p: Place) => (p.creates + p.edits > 0 ? 1 : 0)
  return [...byPath.values()].sort((a, b) => changed(b) - changed(a) || b.last - a.last)
}
