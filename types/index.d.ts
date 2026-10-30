export type StepStatus = 'done' | 'active' | 'pending' | 'failed'

export type Step = {
  title: string
  status: StepStatus
  note?: string
  startedAt?: number
  doneAt?: number
}

/** Claude's own task list, read from its plan tools. */
export type Plan = { title: string; steps: Step[]; source: string; updatedAt: number }

/** A progress file a script keeps rewriting, e.g. an E2E runner's progress.json. */
export type Feed = { path: string; title: string; steps: Step[]; error?: string; updatedAt: number }

export type Kind = 'read' | 'search' | 'edit' | 'run' | 'web' | 'agent' | 'you' | 'plan' | 'other'

/** One thing Claude did behind the scenes: a tool call, in plain words. */
export type Call = {
  id: string
  kind: Kind
  label: string
  detail: string
  isHelper: boolean
  startedAt: number
  endedAt?: number
  isError?: boolean
  /** The full path of the file it read, created or edited, for "Where Claude worked". */
  target?: string
  /** What the action was given (a command, a file path, its arguments), for the detail view. */
  input?: string
  /** The start of what it returned or why it failed, for the detail view. */
  output?: string
}

export type BgStatus = 'running' | 'done' | 'failed' | 'stopped'

/** Work Claude started in the background and waits on: a helper (subagent or workflow agent) or a command. */
export type BgTask = {
  id: string
  kind: 'agent' | 'shell'
  title: string
  startedAt: number
  status: BgStatus
  endedAt?: number
  /** Its latest action in plain words, and when: the proof that it is still working. */
  lastAction?: string
  lastAt?: number
  actions: number
  /** A background command's own id, as its notification names it. */
  shellId?: string
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The model and effort level of Claude's latest request, as actually sent. */
export type Engine = { model: string; effort: string; at: number }

export type Turn = {
  isRunning: boolean
  turnId: string
  startedAt: number
  endedAt: number
  model: string
}

export type AskOption = { label: string; description?: string; message?: string }
export type AskQuestion = { question: string; header?: string; options: AskOption[]; multiSelect: boolean }

/**
 * Something Claude is waiting on you for. `question`: its AskUserQuestion,
 * moved into the panel. `choice`: the buttons of its end-of-turn box.
 * `reply`: its last message ended with a question.
 */
export type Ask = {
  id: string
  source: 'question' | 'choice' | 'reply'
  questions: AskQuestion[]
  picks: string[][]
  at: number
  /** With several questions, the one whose tab is open. */
  tab?: number
}

export type QuestionMode = 'panel' | 'dialog'

/** One status line in Claude's own voice: what it is doing now, in plain words. */
export type Narration = { text: string; at: number }

/**
 * The copyable recap offered when Claude finishes or pauses, written from the
 * session's own history: a summary, what changed, or what's next.
 */
export type SummaryKind = 'summary' | 'changes' | 'next'
export type RecapScope = 'since' | 'all'
export type Summary = { kind: SummaryKind; status: 'offer' | 'loading' | 'ready' | 'error'; text: string; at: number; scope?: RecapScope }

/** What the panel showed when a checkpoint was saved. */
export type Snapshot = {
  planTitle: string
  steps: { title: string; status: StepStatus }[]
  filesChanged: string[]
  actions: number
  health: string
}

/**
 * A saved point in the session: a short recap of the work since the
 * previous checkpoint, and a snapshot of the panel at that moment.
 */
export type Checkpoint = {
  id: string
  at: number
  /** When the work this checkpoint covers began: the previous checkpoint, or the session start. */
  since: number
  status: 'writing' | 'ready' | 'error'
  summary: string
  snapshot: Snapshot
  /** The questions still open when it was saved: a decision left for later, such as how to carry out a plan. */
  pending?: AskQuestion[]
  /** Saved by the panel on its own, on the autosave timer or when a task finished. */
  isAuto?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'live-view': {
      plan: Plan
      feed: Feed
      calls: Call[]
      turn: Turn
      ask: Ask | null
      tick: number
      mode: QuestionMode
      sent: string
      summary: Summary | null
      engine: Engine
      effortChoice: EffortLevel | ''
      openCall: string
      showDetails: boolean
      openFile: string
      checkpoints: Checkpoint[]
      openCheckpoint: string
      recapScope: RecapScope
      resume: Checkpoint | null
      narration: Narration[]
      narrateOn: boolean
      background: BgTask[]
      /** When the session began: its first launch when resumed, the moment of a /clear after one. 0 until known. */
      sessionStart: number
      /** How often the panel saves a checkpoint on its own, in milliseconds; 0 is off. */
      autosave: number
    }
  }
}
