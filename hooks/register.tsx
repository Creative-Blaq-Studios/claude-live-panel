import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, AskQuestion, BgTask, Call, Checkpoint, EffortLevel, Engine, Feed, Narration, Plan, QuestionMode, RecapScope, Snapshot, Step, Summary, SummaryKind, Turn } from '../types'
import { agentEnd, endedTasks, endTask, noteAction, QUIET_AFTER, quietFor, setShellId, shellIdFrom, startTask, visibleTasks } from './background'
import {
  AUTOSAVE_CHOICES,
  CHECKPOINTS,
  DEFAULT_AUTOSAVE,
  everyLabel,
  isAutosaveDue,
  isTaskFinished,
  lastManual,
  parseEvery,
  pruneSaved,
  replacedAutos,
  settleDecision,
} from './checkpoints'
import type { Tone } from './model'
import {
  activityShares,
  answerText,
  CHECKPOINT_PROMPT,
  decisionNote,
  choiceFromWrapUp,
  classify,
  clip,
  duration,
  EFFORT_LABEL,
  EMPTY_FEED,
  EMPTY_PLAN,
  health,
  inputDetail,
  isPlanTool,
  NARRATE_SYSTEM,
  narrationPrompt,
  nowDoing,
  PAL,
  parseFeed,
  parseQuestions,
  planFromTool,
  replyFromText,
  sectionNote,
  sessionLine,
  STE_RULES,
  places,
  SUMMARY_KINDS,
  SUMMARY_LABEL,
  SUMMARY_PROMPTS,
  steClean,
  timeLeft,
} from './model'
import { activitySvg, BAR_WIDTH, railSvg, ringSvg } from './svg'

const PANE = 'live-view'
const RECAP_PANE = 'live-view-recap'
const TITLE = 'Live'
const LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const TONE: Record<Tone, string> = { now: PAL.now, failed: PAL.failed, done: PAL.done, slow: '#C9A24A', muted: PAL.waiting }

const plan = atom({ plugin: 'live-view', key: 'plan' } as const, EMPTY_PLAN as Plan)
const feed = atom({ plugin: 'live-view', key: 'feed' } as const, EMPTY_FEED as Feed)
const calls = atom({ plugin: 'live-view', key: 'calls' } as const, [] as Call[])
const turn = atom({ plugin: 'live-view', key: 'turn' } as const, { isRunning: false, turnId: '', startedAt: 0, endedAt: 0, model: '' } as Turn)
const ask = atom({ plugin: 'live-view', key: 'ask' } as const, null as Ask | null)
const tick = atom({ plugin: 'live-view', key: 'tick' } as const, 0)
const mode = atom({ plugin: 'live-view', key: 'mode' } as const, 'panel' as QuestionMode)
const sent = atom({ plugin: 'live-view', key: 'sent' } as const, '')
const summary = atom({ plugin: 'live-view', key: 'summary' } as const, null as Summary | null)
const engine = atom({ plugin: 'live-view', key: 'engine' } as const, { model: '', effort: '', at: 0 } as Engine)
const effortChoice = atom({ plugin: 'live-view', key: 'effortChoice' } as const, '' as EffortLevel | '')
const openCall = atom({ plugin: 'live-view', key: 'openCall' } as const, '')
const showDetails = atom({ plugin: 'live-view', key: 'showDetails' } as const, false)
const openFile = atom({ plugin: 'live-view', key: 'openFile' } as const, '')
const checkpoints = atom({ plugin: 'live-view', key: 'checkpoints' } as const, [] as Checkpoint[])
const openCheckpoint = atom({ plugin: 'live-view', key: 'openCheckpoint' } as const, '')
const recapScope = atom({ plugin: 'live-view', key: 'recapScope' } as const, 'since' as RecapScope)
const resume = atom({ plugin: 'live-view', key: 'resume' } as const, null as Checkpoint | null)
const narration = atom({ plugin: 'live-view', key: 'narration' } as const, [] as Narration[])
const narrateOn = atom({ plugin: 'live-view', key: 'narrateOn' } as const, true)
const background = atom({ plugin: 'live-view', key: 'background' } as const, [] as BgTask[])
const sessionStart = atom({ plugin: 'live-view', key: 'sessionStart' } as const, 0)
const autosave = atom({ plugin: 'live-view', key: 'autosave' } as const, DEFAULT_AUTOSAVE)

// Automatic checkpoints: one at a time, and a try that failed waits a whole interval before the next.
let loadedAt = 0
let autoTriedAt = 0
let isAutoSaving = false

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
/** The recap in a tab of its own, full height, so a long one reads top to bottom. */
const openRecap = ($: EngineInterface) => $.ui.open({ id: RECAP_PANE, title: 'Recap', focus: true }).catch(() => ({ isPlaced: false }))
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

/** Sends text to Claude as the person's own words, and clears the card it answered. */
async function send($: EngineInterface, text: string): Promise<void> {
  const body = text.trim()
  if (body === '') return
  await update($, ask, () => null)
  await update($, sent, () => clip(body, 200))
  await $.prompt.submit({ text: body, asUser: true })
}

/**
 * Asks Claude, off to the side, for a recap: a summary, what changed, or what's next.
 * By default it covers only the work since the last checkpoint; 'all' covers the whole session.
 */
async function writeSummary($: EngineInterface, kind: SummaryKind, scopeArg?: RecapScope): Promise<Summary | null> {
  const at = Date.now()
  const last = lastManual(await read($, checkpoints))
  const scope: RecapScope = last ? (scopeArg ?? (await read($, recapScope))) : 'all'
  await update($, summary, (): Summary => ({ kind, status: 'loading', text: '', at, scope }))
  const section = scope === 'since' && last ? (await read($, calls)).filter(c => c.startedAt >= last.at) : []
  const prompt = SUMMARY_PROMPTS[kind] + (scope === 'since' && last ? ` ${sectionNote(last, section)}` : '')
  const reply = await $.model.fork({ prompt }).catch(() => undefined)
  const text = reply?.isAnswered ? steClean(reply.text).trim() : ''
  const why = reply && !reply.isAnswered ? ` (${reply.reason})` : ''
  return update($, summary, (cur): Summary | null =>
    cur && cur.at === at
      ? { ...cur, status: text ? 'ready' : 'error', text: text || `Couldn't write it this time${why}. Try again in a moment.` }
      : cur,
  )
}

/** Asks the small fast model for one status line in Claude's voice, from the plan and the latest actions only. */
async function narrate($: EngineInterface): Promise<void> {
  const previous = (await read($, narration)).at(-1)?.text ?? ''
  const prompt = narrationPrompt(await read($, plan), await read($, calls), previous)
  const reply = await $.model.complete({ model: 'haiku', system: NARRATE_SYSTEM, prompt, maxTokens: 120 }).catch(() => undefined)
  const text = reply?.isAnswered ? steClean(reply.text).trim() : ''
  if (text) await update($, narration, list => [...list, { text, at: Date.now() }].slice(-6))
}

/** Where this project's checkpoints are kept between sessions. */
const checkpointKey = async ($: EngineInterface) => `${CHECKPOINTS}${await $.session.root().catch(() => 'unknown')}`

/**
 * Saves a checkpoint: a snapshot of the panel now, and a short recap of the work since the last one
 * the person saved. With `pause`, Claude stops first. The checkpoint is also kept for later sessions in
 * this project. With its recap, it replaces the automatic checkpoints since that last manual one, as it
 * covers their work again; an automatic one (`isAuto`) without its recap is dropped, and the one before stays.
 */
async function saveCheckpoint($: EngineInterface, pause: boolean, pending: AskQuestion[] = [], isAuto = false): Promise<Checkpoint> {
  const t = await read($, turn)
  if (pause && t.isRunning && t.turnId) await $.turn.abort({ turnId: t.turnId }).catch(() => undefined)
  const list = await read($, checkpoints)
  const last = lastManual(list)
  const replaces = replacedAutos(list, last)
  const allCalls = await read($, calls)
  const p = await read($, plan)
  const section = allCalls.filter(c => c.startedAt >= (last?.at ?? 0))
  const now = Date.now()
  const snapshot: Snapshot = {
    planTitle: p.title || 'Progress',
    steps: p.steps.map(st => ({ title: st.title, status: st.status })),
    filesChanged: places(section).filter(pl => pl.creates + pl.edits > 0).map(pl => pl.name),
    actions: section.length,
    health: pending.length ? 'Waiting for your decision' : pause ? 'Paused' : health({ hasAsk: false, isRunning: false, hadTurn: true, steps: p.steps, calls: allCalls }, now).label,
  }
  const began = (await read($, sessionStart)) || t.startedAt || now
  const cp: Checkpoint = {
    id: `cp${now}`,
    at: now,
    since: last?.at ?? began,
    status: 'writing',
    summary: '',
    snapshot,
    ...(pending.length ? { pending } : {}),
    ...(isAuto ? { isAuto: true } : {}),
  }
  await update($, checkpoints, l => [...l, cp].slice(-20))
  if (!isAuto) await update($, openCheckpoint, () => cp.id)
  const reply = await $.model.fork({ prompt: CHECKPOINT_PROMPT + sectionNote(last, section) + decisionNote(pending) + STE_RULES }).catch(() => undefined)
  const text = reply?.isAnswered ? steClean(reply.text).trim() : ''
  const done: Checkpoint = { ...cp, status: text ? 'ready' : 'error', summary: text || "Couldn't write the recap for this checkpoint. The snapshot is saved." }
  // A manual checkpoint saved while this one was written has replaced it already.
  const isReplaced = isAuto && !(await read($, checkpoints)).some(c => c.id === cp.id)
  if (isAuto && (!text || isReplaced)) {
    await update($, checkpoints, l => l.filter(c => c.id !== cp.id))
    return done
  }
  const gone = done.status === 'ready' ? replaces : []
  await update($, checkpoints, l => l.filter(c => !gone.includes(c.id)).map(c => (c.id === cp.id ? done : c)))
  // A decision left for later is kept even without its recap: the next session needs the question.
  let isKept = true
  if (done.status === 'ready' || pending.length) {
    const key = await checkpointKey($)
    const stored = await $.store.get(key).catch(() => undefined)
    const prev = Array.isArray(stored) ? (stored as Checkpoint[]).filter(c => !gone.includes(c.id)) : []
    isKept = await $.store.set(key, pruneSaved([...prev, done], now)).then(() => true, () => false)
  }
  if (!isKept) $.ui.toast("Couldn't keep this checkpoint for later sessions. It stays in the panel until the session closes. Type /live checkpoints to see what is saved.")
  else if (!isAuto) $.ui.toast(pending.length ? 'Checkpoint saved. Decide when you come back, in this session or the next.' : pause ? 'Paused. Checkpoint saved.' : 'Checkpoint saved.')
  return done
}

/** Saves an automatic checkpoint, unless one is being written now. */
function autoCheckpoint($: EngineInterface): void {
  if (isAutoSaving) return
  isAutoSaving = true
  autoTriedAt = Date.now()
  void saveCheckpoint($, false, [], true)
    .catch(() => undefined)
    .finally(() => {
      isAutoSaving = false
    })
}

/** Once a day: drops saved checkpoints older than 30 days (an open decision stays), and the lists of project folders that are gone. */
async function cleanUpSaved($: EngineInterface): Promise<void> {
  const cleanedAt = await $.store.get('cleanedAt').catch(() => undefined)
  if (typeof cleanedAt === 'number' && Date.now() - cleanedAt < DAY) return
  await $.store.set('cleanedAt', Date.now()).catch(() => undefined)
  const now = Date.now()
  for (const key of await $.store.keys().catch(() => [] as string[])) {
    if (!key.startsWith(CHECKPOINTS)) continue
    const folder = key.slice(CHECKPOINTS.length)
    // Only a folder that is surely not there: a stat refused for another reason leaves the list as it is.
    const isGone = /^(\/|[A-Za-z]:[\\/])/.test(folder) && (await $.fs.stat(folder).then(() => false, (err: unknown) => /ENOENT/.test(String((err as { code?: unknown })?.code ?? err))))
    const stored = await $.store.get(key).catch(() => undefined)
    const kept = isGone || !Array.isArray(stored) ? [] : pruneSaved(stored as Checkpoint[], now)
    if (kept.length === 0) await $.store.delete(key).catch(() => undefined)
    else if (kept.length !== (stored as unknown[]).length) await $.store.set(key, kept).catch(() => undefined)
  }
}

/** What the panel keeps on disk: this project's saved checkpoints, and the size of all of its data. */
async function storageReport($: EngineInterface): Promise<string> {
  const key = await checkpointKey($)
  let bytes = 0
  let projects = 0
  for (const k of await $.store.keys().catch(() => [] as string[])) {
    bytes += k.length + JSON.stringify((await $.store.get(k).catch(() => null)) ?? null).length
    if (k.startsWith(CHECKPOINTS)) projects++
  }
  const own = await $.store.get(key).catch(() => undefined)
  const count = Array.isArray(own) ? own.length : 0
  const every = await read($, autosave)
  return (
    `This project has ${count} saved checkpoint${count === 1 ? '' : 's'}. Automatic checkpoints: ${everyLabel(every).toLowerCase()}. ` +
    `All the data of the Live panel uses ${(bytes / 1024).toFixed(1)} KB of 4 MB, with checkpoints for ${projects} project${projects === 1 ? '' : 's'}. ` +
    'Saved checkpoints older than 30 days are removed, unless a decision in them is open. ' +
    "Type /live checkpoints clear to delete this project's saved checkpoints."
  )
}

/**
 * Asks Claude to pick up the work from a checkpoint. With a decision left open, `choice` is the
 * option the person picked now; without one, Claude asks the question again.
 */
async function continueFrom($: EngineInterface, cp: Checkpoint, choice?: string): Promise<void> {
  await update($, resume, () => null)
  const when = `${new Date(cp.at).toDateString().slice(4, 10)} ${clock(cp.at).slice(0, 5)}`
  const open = cp.pending ?? []
  // The decision now goes on in the chat: the checkpoint no longer keeps it open, here or on disk.
  if (open.length) {
    await update($, checkpoints, l => settleDecision(l, cp.id))
    const key = await checkpointKey($)
    const stored = await $.store.get(key).catch(() => undefined)
    if (Array.isArray(stored)) await $.store.set(key, settleDecision(stored as Checkpoint[], cp.id)).catch(() => undefined)
  }
  const decision =
    choice && open[0] ? `For "${open[0].question}", I chose: ${choice}. ` : open.length ? `First ask me again: ${open.map(q => q.question).join(' ')} ` : ''
  await send($, `Continue from this checkpoint (saved ${when}). ${decision}Start with the "Continue with" step.\n\n${cp.summary}`)
}

/** Leaves Claude's question open: saves a checkpoint that keeps it, to decide in this session or the next. */
async function decideLater($: EngineInterface): Promise<void> {
  const a = await read($, ask)
  if (!a) return
  await update($, ask, () => null)
  await saveCheckpoint($, false, a.questions)
}

/** Copies the summary; where the surface can't, puts it in the message box to copy from there. */
async function copySummary($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const cur = await read($, summary)
  if (cur?.text) await copyText($, cur.text, surface)
}

/** Copies text; where the surface can't, puts it in the message box to copy from there. */
async function copyText($: EngineInterface, text: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const cur = { text }
  const copied = await $.ui.copy({ text: cur.text, surface }).catch(() => ({ isCopied: false as const }))
  if (copied.isCopied) {
    $.ui.toast('Copied. Paste it wherever you need it.')
    return
  }
  const box = await $.prompt.read()
  if (box.text.trim() === '') {
    await $.prompt.fill({ text: cur.text })
    $.ui.toast('Put in your message box. Select it there and copy it (it is not sent).')
  } else {
    $.ui.toast('Select the text in the panel and copy it.')
  }
}

/** Sets the effort level Claude's next requests use; '' goes back to the session's own setting. */
async function setEffort($: EngineInterface, level: EffortLevel | ''): Promise<void> {
  await update($, effortChoice, () => level)
  await $.store.set('effortChoice', level).catch(() => undefined)
  $.ui.toast(level ? `Effort set to ${EFFORT_LABEL[level]} from Claude's next step.` : 'Effort back to the session setting.')
}

/** Sets how often the panel saves a checkpoint by itself, for this session and the next ones; 0 is off. */
async function setAutosave($: EngineInterface, every: number): Promise<void> {
  await update($, autosave, () => every)
  await $.store.set('autosave', every).catch(() => undefined)
}

const PLUGIN_ID = 'live-view@claude-live-panel'
const MARKETPLACE = 'claude-live-panel'
const LATEST_MANIFEST = 'https://raw.githubusercontent.com/Creative-Blaq-Studios/claude-live-panel/main/.claude-plugin/plugin.json'
const DAY = 24 * 60 * 60 * 1000

const versionOf = (json: string) => {
  const v = (JSON.parse(json) as { version?: unknown }).version
  return typeof v === 'string' ? v : ''
}
const isNewer = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** This copy's version, and the newest one on GitHub ('' when it can't be read). */
async function versions($: EngineInterface): Promise<{ own: string; latest: string }> {
  const own = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(versionOf).catch(() => '')
  const res = await $.http.fetch(LATEST_MANIFEST).catch(() => undefined)
  const latest = res?.ok ? (() => { try { return versionOf(res.text) } catch { return '' } })() : ''
  return { own, latest }
}

/** Gets the newest version from GitHub through Claude Code's own plugin commands. */
async function updatePlugin($: EngineInterface): Promise<string> {
  // A copy loaded from a folder (a clone, --plugin-dir) is not the installed plugin: git updates it.
  if (!$.plugin.root.includes('/.claude/plugins/cache/')) {
    return `This copy of the panel loads from ${$.plugin.root}, not from the installed plugin. To update it, get the latest files from GitHub (for example, git pull in that folder).`
  }
  const { own, latest } = await versions($)
  if (latest && own && !isNewer(latest, own)) return `The Live panel is up to date (version ${own}).`
  const claude = (await $.env.get('CLAUDE_CODE_EXECPATH').catch(() => undefined)) || 'claude'
  $.ui.toast('Getting the newest Live panel from GitHub…')
  const refresh = await $.process.run([claude, 'plugin', 'marketplace', 'update', MARKETPLACE], { timeoutMs: 120_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  if (refresh.exitCode !== 0) return `Couldn't reach the plugin list on GitHub. ${clip(refresh.stderr.trim() || refresh.stdout.trim(), 200)}`
  const run = await $.process.run([claude, 'plugin', 'update', PLUGIN_ID, '--json', '-y'], { timeoutMs: 180_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  const line = run.stdout.trim().split('\n').pop() ?? ''
  let result: { outcome?: string; updateOutcome?: string; newVersion?: string; message?: string } = {}
  try {
    result = JSON.parse(line)
  } catch {}
  if (run.exitCode !== 0 || result.outcome !== 'ok') return `The update did not work. ${clip(result.message || run.stderr.trim() || line, 200)} You can also update it with /plugin.`
  if (result.updateOutcome !== 'updated') return `The Live panel is up to date (version ${result.newVersion || own}).`
  return `The Live panel is updated to version ${result.newVersion}. Type /reload-plugins, or start a new session, to use it.`
}

/** Once a day, tells you when GitHub has a newer version. */
async function checkForUpdate($: EngineInterface): Promise<void> {
  const checkedAt = await $.store.get('updateCheckedAt').catch(() => undefined)
  if (typeof checkedAt === 'number' && Date.now() - checkedAt < DAY) return
  await $.store.set('updateCheckedAt', Date.now()).catch(() => undefined)
  const { own, latest } = await versions($)
  if (!own || !latest || !isNewer(latest, own)) return
  $.ui.toast(`Live panel ${latest} is available. Type /live update to get it.`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'live',
      description: 'Open the Live panel: progress, what Claude is doing, effort level, and questions for you',
      argumentHint:
        '[pause | checkpoint | checkpoints [clear] | autosave 30m|1h|off | effort low|medium|high|xhigh|max|session | summary [changes|next] [all] | summaries on|off | narrate on|off | watch <file> | unwatch | questions panel|dialog | update | version]',
    })
    loadedAt = Date.now()
    autoTriedAt = 0
    const usage = await $.session.usage().catch(() => undefined)
    await update($, sessionStart, () => usage?.startedAt || Date.now())
    const savedEvery = await $.store.get('autosave').catch(() => undefined)
    if (typeof savedEvery === 'number' && savedEvery >= 0) await update($, autosave, () => savedEvery)
    await cleanUpSaved($).catch(() => undefined)
    const savedMode = await $.store.get('mode').catch(() => undefined)
    if (savedMode === 'panel' || savedMode === 'dialog') await update($, mode, () => savedMode)
    const savedEffort = await $.store.get('effortChoice').catch(() => undefined)
    if (typeof savedEffort === 'string' && (savedEffort === '' || (LEVELS as string[]).includes(savedEffort))) {
      await update($, effortChoice, () => savedEffort as EffortLevel | '')
    }
    const savedFeed = await $.store.get('feedPath').catch(() => undefined)
    if (typeof savedFeed === 'string' && savedFeed !== '') await update($, feed, () => ({ ...EMPTY_FEED, path: savedFeed, error: 'waiting for the file' }))
    const stored = await $.store.get(await checkpointKey($)).catch(() => undefined)
    if (Array.isArray(stored) && stored.length > 0 && (await read($, checkpoints)).length === 0) {
      await update($, resume, () => stored[stored.length - 1] as Checkpoint)
    }
    if ((await $.store.get('narrate').catch(() => undefined)) === false) await update($, narrateOn, () => false)
    const autoOpen = await $.store.get('autoOpen').catch(() => undefined)
    if (autoOpen !== false) void openPane($)
    void checkForUpdate($).catch(() => undefined)

    // The live loop: follow a progress file, keep timers ticking while work runs, and narrate now and then.
    let lastText = ''
    let narratedAt = 0
    let narratedStep = ''
    let isNarrating = false
    let listedAt = 0
    let usageAt = Date.now()
    $.clock.every(1000, async () => {
      const f = await read($, feed)
      if (f.path !== '') {
        const text = await $.fs.read(f.path).catch(() => '')
        if (text !== lastText) {
          lastText = text
          const fresh = text === '' ? { ...f, error: 'waiting for the file' } : parseFeed(f.path, text, Date.now(), f.steps)
          await update($, feed, () => fresh)
        }
      }
      const t = await read($, turn)
      const active = f.steps.some(s => s.status === 'active')
      const waitsOnBackground = (await read($, background)).some(b => b.status === 'running')
      // Work redraws every second; an idle panel still moves the session clock along every 15 seconds.
      const isBusy = t.isRunning || active || waitsOnBackground || !!(await read($, ask))
      if (isBusy || Date.now() - (await read($, tick)) > 15_000) await update($, tick, () => Date.now())
      // A /clear starts the session over: read its start again now and then (the call costs nothing).
      if (Date.now() - usageAt > 30_000) {
        usageAt = Date.now()
        const began = (await $.session.usage().catch(() => undefined))?.startedAt
        if (began) await update($, sessionStart, cur => (cur === began ? cur : began))
      }
      // Automatic checkpoints on the timer: only after new work since the last checkpoint.
      const every = await read($, autosave)
      if (every > 0 && !isAutoSaving) {
        const lastAt = Math.max(loadedAt, autoTriedAt, ...(await read($, checkpoints)).map(c => c.at))
        const workAt = (await read($, calls)).reduce((max, c) => (c.isHelper ? max : Math.max(max, c.startedAt)), 0)
        if (isAutosaveDue({ every, lastAt, workAt, now: Date.now() })) autoCheckpoint($)
      }
      // A helper whose end the engine never announced: its loop's own status settles it.
      if (waitsOnBackground && Date.now() - listedAt > 5000) {
        listedAt = Date.now()
        const loops = await $.agent.list().catch(() => undefined)
        if (loops) {
          await update($, background, list =>
            loops.reduce((acc, loop) => {
              const end = agentEnd(loop.status)
              return end ? endTask(acc, loop.id, end, Date.now()) : acc
            }, list),
          )
        }
      }

      // A new line when the step changes, else at most once a minute, and only after new actions.
      if (!t.isRunning || isNarrating || !(await read($, narrateOn))) return
      const now = Date.now()
      const p = await read($, plan)
      const step = `${p.steps.findIndex(s => s.status === 'active')}:${p.steps.filter(s => s.status === 'done').length}`
      const fresh = (await read($, calls)).filter(c => !c.isHelper && c.startedAt > Math.max(narratedAt, t.startedAt)).length
      const isDue = (step !== narratedStep && now - narratedAt > 15_000 && fresh >= 1) || (now - narratedAt > 60_000 && fresh >= 3)
      if (!isDue) return
      isNarrating = true
      narratedAt = now
      narratedStep = step
      void narrate($).finally(() => {
        isNarrating = false
      })
    })

    return next(e)
  })

  on('command.run', { command: 'live' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()
    if (verb === 'effort' && (arg === 'session' || (LEVELS as string[]).includes(arg))) {
      await setEffort($, arg === 'session' ? '' : (arg as EffortLevel))
      return { text: arg === 'session' ? 'Effort follows the session setting again.' : `Effort set to ${EFFORT_LABEL[arg]} for Claude's next steps.` }
    }
    if (verb === 'watch' && arg !== '') {
      const home = arg.startsWith('~/') ? await $.env.get('HOME').catch(() => undefined) : undefined
      const path = home ? home + arg.slice(1) : arg
      await update($, feed, () => ({ ...EMPTY_FEED, path, error: 'waiting for the file' }))
      await $.store.set('feedPath', path).catch(() => undefined)
      await openPane($)
      return { text: `The Live panel now follows ${path} and re-reads it every second.` }
    }
    if (verb === 'unwatch') {
      await update($, feed, () => EMPTY_FEED)
      await $.store.set('feedPath', '').catch(() => undefined)
      return { text: 'The Live panel stopped following the progress file.' }
    }
    if (verb === 'questions' && (arg === 'panel' || arg === 'dialog')) {
      await update($, mode, () => arg)
      await $.store.set('mode', arg).catch(() => undefined)
      return { text: arg === 'panel' ? "Claude's questions now open in the Live panel." : "Claude's questions now open in the usual dialog; the panel only shows them." }
    }
    if (verb === 'summaries' && (arg === 'on' || arg === 'off')) {
      await $.store.set('summaries', arg === 'on').catch(() => undefined)
      if (arg === 'off') await update($, summary, () => null)
      return { text: `The Live panel will ${arg === 'on' ? '' : 'no longer '}offer a copyable recap when Claude finishes or pauses.` }
    }
    if (verb === 'summary') {
      const words = arg.split(/\s+/).filter(Boolean)
      const kind: SummaryKind = words.includes('changes') ? 'changes' : words.includes('next') ? 'next' : 'summary'
      const opened = await openPane($)
      const written = await writeSummary($, kind, words.includes('all') ? 'all' : undefined)
      // Where no panel can be drawn (the VS Code extension today), the recap goes into the chat instead.
      if (!opened.isPlaced && written) return { text: `${SUMMARY_LABEL[kind]}${written.scope === 'since' ? ' (since the last checkpoint)' : ''}:\n\n${written.text}` }
      return { text: `${SUMMARY_LABEL[kind]} is ready in the Live panel.` }
    }
    if (verb === 'checkpoint' || verb === 'pause') {
      const opened = await openPane($)
      const cp = await saveCheckpoint($, verb === 'pause')
      const lead = verb === 'pause' ? 'Paused. Checkpoint saved' : 'Checkpoint saved'
      if (!opened.isPlaced) {
        const files = cp.snapshot.filesChanged.length ? `\nFiles changed: ${cp.snapshot.filesChanged.join(', ')}` : ''
        const steps = cp.snapshot.steps.length ? `\nSteps done: ${cp.snapshot.steps.filter(st => st.status === 'done').length} of ${cp.snapshot.steps.length}` : ''
        return { text: `${lead} at ${clock(cp.at).slice(0, 5)}.${steps}${files}\n\n${cp.summary}` }
      }
      return { text: `${lead}. It is in the Live panel.` }
    }
    if (verb === 'autosave' && arg !== '') {
      const every = parseEvery(arg)
      if (every === undefined) return { text: 'Give a time between 10 minutes and 8 hours, for example /live autosave 30m or /live autosave 1h. Use /live autosave off to stop it.' }
      await setAutosave($, every)
      return { text: every ? `The Live panel will save a checkpoint by itself ${everyLabel(every).toLowerCase()} while Claude works, and when a task list is done.` : 'The Live panel will not save checkpoints by itself. Save them with Pause and save checkpoint or /live checkpoint.' }
    }
    if (verb === 'checkpoints') {
      if (arg === 'clear') {
        const key = await checkpointKey($)
        const stored = await $.store.get(key).catch(() => undefined)
        const count = Array.isArray(stored) ? stored.length : 0
        if (count === 0) return { text: 'This project has no saved checkpoints.' }
        await $.store.delete(key).catch(() => undefined)
        await update($, resume, () => null)
        return { text: `Deleted the ${count} saved checkpoint${count === 1 ? '' : 's'} of this project. The checkpoints of this session stay in the panel until it closes.` }
      }
      return { text: await storageReport($) }
    }
    if (verb === 'narrate' && (arg === 'on' || arg === 'off')) {
      await update($, narrateOn, () => arg === 'on')
      await $.store.set('narrate', arg === 'on').catch(() => undefined)
      return { text: `The Live panel will ${arg === 'on' ? '' : 'no longer '}show short updates from Claude in plain words while it works.` }
    }
    if (verb === 'update') return { text: await updatePlugin($) }
    if (verb === 'version') {
      const { own, latest } = await versions($)
      const tail = latest && own && isNewer(latest, own) ? ` Version ${latest} is available. Type /live update to get it.` : latest ? ' It is the newest version.' : ''
      return { text: `This is the Live panel version ${own || 'unknown'}.${tail}` }
    }
    if (verb === 'autoopen' && (arg === 'on' || arg === 'off')) {
      await $.store.set('autoOpen', arg === 'on').catch(() => undefined)
      return { text: `The Live panel will ${arg === 'on' ? '' : 'not '}open by itself when a session starts.` }
    }
    await openPane($)
    const began = await read($, sessionStart)
    return { text: `Live panel opened.${began ? ` ${sessionLine(began, Date.now())}.` : ''}` }
  })

  // Every request Claude makes: note the model and effort actually used, and apply the panel's effort choice.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const choice = await read($, effortChoice)
    const step = choice && e.effort !== undefined ? { ...e, effort: choice } : e
    await update($, engine, () => ({ model: step.model, effort: step.effort === undefined ? '' : String(step.effort), at: Date.now() }))
    return yield* next(step)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const model = await $.session.model().catch(() => '')
      await update($, turn, () => ({ isRunning: true, turnId: e.turnId, startedAt: Date.now(), endedAt: 0, model }))
      await update($, ask, a => (a && a.source !== 'question' ? null : a))
      await update($, summary, cur => (cur?.status === 'offer' ? null : cur))
      await update($, resume, () => null)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      const ended = e.agentId
      await update($, background, list => endTask(list, ended, e.isAborted ? 'stopped' : 'done', Date.now()))
    }
    if (e.agentId === undefined) {
      const ended = Date.now()
      await update($, turn, t => ({ ...t, isRunning: false, endedAt: ended }))
      // Anything the turn left running (stopped or interrupted) is over now: stop its timer.
      await update($, calls, list => (list.some(c => c.endedAt === undefined) ? list.map(c => (c.endedAt === undefined ? { ...c, endedAt: ended } : c)) : list))
      const text = e.answer
      if (!e.isAborted && text) {
        const reply = replyFromText(text, e.turnId, Date.now())
        if (reply) await update($, ask, a => a ?? reply)
      }
      // Claude finished or paused: offer a copyable summary, unless one is being written or shown.
      const wanted = await $.store.get('summaries').catch(() => undefined)
      const waitingOnPanel = (await read($, ask))?.source === 'question'
      if (wanted !== false && !waitingOnPanel) {
        await update($, summary, (cur): Summary | null => (cur && cur.status !== 'offer' ? cur : { kind: 'summary', status: 'offer', text: '', at: Date.now() }))
      }
      // The whole task list is done: keep where things stand, without waiting for the timer.
      if (!e.isAborted && (await read($, autosave)) > 0) {
        const lastAt = Math.max(0, ...(await read($, checkpoints)).map(c => c.at))
        if (isTaskFinished((await read($, plan)).steps, lastAt)) autoCheckpoint($)
      }
    }
    return result
  })

  // Every tool call: record it in plain words with its full detail, follow plan changes, and move questions into the panel.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const isMain = e.agentId === undefined
    const now = Date.now()

    if (isMain && isPlanTool(tool)) {
      const prev = await read($, plan)
      const fresh = planFromTool(tool, input, prev, now)
      if (fresh) await update($, plan, () => fresh)
    }
    if (isMain && tool === 'mcp__ccd_turn__wrap_up') {
      const choice = choiceFromWrapUp(input, e.tool_use_id, now)
      if (choice) await update($, ask, () => choice)
    }

    const what = classify(tool, input)
    if (e.agentId !== undefined) {
      const helper = e.agentId
      await update($, background, list => noteAction(list, helper, what.detail ? `${what.label} · ${clip(what.detail, 60)}` : what.label, now))
    }
    const isBgShell = tool === 'Bash' && input.run_in_background === true
    if (isBgShell) {
      await update($, background, list => startTask(list, { id: e.tool_use_id, kind: 'shell', title: what.detail || 'A command', startedAt: now, status: 'running', actions: 0 }, now))
    }
    const file = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)
      ? String(input.file_path ?? input.notebook_path ?? '')
      : ''
    const entry: Call = { id: e.tool_use_id, ...what, isHelper: !isMain, startedAt: now, input: inputDetail(tool, input), ...(file ? { target: file } : {}) }
    await update($, calls, list => [...list.filter(c => c.startedAt > now - 30 * 60_000), entry].slice(-80))
    const finish = (isError: boolean, output?: string) =>
      update($, calls, list =>
        list.map(c => (c.id === entry.id ? { ...c, endedAt: Date.now(), isError, ...(output ? { output: clip(output, 1500) } : {}) } : c)),
      )

    if (isMain && tool === 'AskUserQuestion' && (await read($, mode)) === 'panel') {
      const questions = parseQuestions(input.questions)
      const opened = questions.length > 0 ? await openPane($) : { isPlaced: false }
      if (opened.isPlaced) {
        const fresh: Ask = { id: entry.id, source: 'question', questions, picks: questions.map(() => []), at: now }
        await update($, ask, () => fresh)
        await finish(false, 'Shown in the Live panel for you to answer.')
        const { turnId } = await read($, turn)
        // End the turn once this answer is back with the model, so it waits for the person.
        if (turnId) $.clock.after(400, () => void $.turn.abort({ turnId }).catch(() => undefined))
        return {
          deny:
            'The user is answering this in the Live panel instead of the dialog. Stop here and end your turn ' +
            'without guessing or doing more work; their answer arrives as their next message.',
        }
      }
    }

    let failed = false
    let output: string | undefined
    try {
      const ran = await next(e)
      failed = ran.deny !== undefined || ran.isError === true
      output = ran.deny ?? (typeof ran.text === 'string' ? ran.text : undefined)
      return ran
    } catch (error) {
      failed = true
      output = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      await finish(failed, output)
      if (isBgShell) {
        const shellId = output ? shellIdFrom(output) : undefined
        await update($, background, list => (failed ? endTask(list, entry.id, 'failed', Date.now()) : shellId ? setShellId(list, entry.id, shellId) : list))
      }
      const stopped = tool === 'TaskStop' && !failed ? String(input.task_id ?? input.shell_id ?? '') : ''
      if (stopped) await update($, background, list => endTask(list, stopped, 'stopped', Date.now()))
    }
  }).catch(($, e, next) => next(e))

  // A helper Claude sent to the background: follow it until its own turn ends.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.background && started.deny === undefined && started.agentId && !started.teammateId) {
      const now = Date.now()
      const task: BgTask = { id: started.agentId, kind: 'agent', title: e.description || e.subagentType || 'A helper', startedAt: now, status: 'running', actions: 0 }
      await update($, background, list => startTask(list, task, now))
    }
    return started
  }).catch(($, e, next) => next(e))

  // A background task's end reaches Claude as a <task-notification> message.
  on('prompt.submit', async ($, e, next) => {
    const ended = endedTasks(e.text)
    if (ended.length > 0) {
      await update($, background, list => ended.reduce((acc, x) => endTask(acc, x.id, x.status, Date.now()), list))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: RECAP_PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const sum = await read($, summary)
    if (!sum || sum.status !== 'ready') {
      return (
        <Box flexDirection="column">
          <Text dimColor>{sum?.status === 'loading' ? 'Writing the recap…' : 'No recap yet. Open the Live panel and pick Summary, What changed or What\'s next.'}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{SUMMARY_LABEL[sum.kind]}</Text>
        <Markdown key="recap-text" text={sum.text} />
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="recap-copy" variant="primary" onPress={press => copySummary($, press.surface)}>Copy</Button>
          <Button key="recap-close" role="dismiss" onPress={() => $.ui.close({ id: RECAP_PANE })}>Close</Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Code, Markdown } = els
    // The terminal draws no pictures and mobile no text fields or menus: fall back to text there.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
    const Select = e.surface !== 'mobile' && 'Select' in els ? els.Select : undefined

    const p = await read($, plan)
    const f = await read($, feed)
    const list = await read($, calls)
    const t = await read($, turn)
    const a = await read($, ask)
    const m = await read($, mode)
    const last = await read($, sent)
    const sum = await read($, summary)
    const eng = await read($, engine)
    const choice = await read($, effortChoice)
    const open = await read($, openCall)
    const expanded = await read($, showDetails)
    const fileOpen = await read($, openFile)
    const cps = await read($, checkpoints)
    const cpOpen = await read($, openCheckpoint)
    const scopeNow = await read($, recapScope)
    const back = await read($, resume)
    const lines = await read($, narration)
    const began = await read($, sessionStart)
    const every = await read($, autosave)
    const lastCp = lastManual(cps)
    await read($, tick)
    const now = Date.now()
    const bg = visibleTasks(await read($, background), now)
    const bgRunning = bg.filter(b => b.status === 'running').length
    const cols = Math.max(28, (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 48)
    const px = Math.round(Math.min(560, Math.max(260, cols * 7.4)))

    const state: 'ask' | 'working' | 'finished' | 'idle' = a ? 'ask' : t.isRunning ? 'working' : t.endedAt ? 'finished' : 'idle'
    const signal = health({ hasAsk: !!a, isRunning: t.isRunning, hadTurn: t.endedAt > 0, steps: p.steps, calls: list }, now)
    const tone = TONE[signal.tone]

    // 1. Health, time, model and effort: always on top.
    const model = eng.model || t.model
    const effortNow = eng.effort ? (EFFORT_LABEL[eng.effort] ?? eng.effort) : ''
    const timeText = a ? `waiting ${duration(now - a.at)}` : t.isRunning ? duration(now - t.startedAt) : t.endedAt ? `took ${duration(t.endedAt - t.startedAt)}` : ''
    // VS Code fills every Button that is not dim: there, a dim Button is the quiet, outlined one.
    const isVscode = e.surface === 'vscode'
    const header = (
      <Box key="hdr" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text size="heading" weight="semibold" color={tone}>● {signal.label}</Text>
          <Text dimColor tabular>{timeText}</Text>
        </Box>
        {began ? <Text dimColor size="footnote" tabular>{sessionLine(began, now)}</Text> : null}
        {signal.note ? <Text dimColor wrap="wrap">{signal.note}</Text> : null}
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {model ? <Text dimColor size="footnote">{model}</Text> : null}
          {Select ? (
            <Select
              key="effort"
              label="Effort"
              value={choice || 'session'}
              options={[
                { value: 'session', label: `Session setting${!choice && effortNow ? ` (${effortNow})` : ''}` },
                ...LEVELS.map(level => ({ value: level, label: EFFORT_LABEL[level]! })),
              ]}
              onSelect={(value: string) => setEffort($, value === 'session' ? '' : (value as EffortLevel))}
            />
          ) : effortNow ? (
            <Text dimColor>· effort {effortNow}</Text>
          ) : null}
        </Box>
        {choice && effortNow && EFFORT_LABEL[choice] !== effortNow ? <Text dimColor>Effort {EFFORT_LABEL[choice]} applies from Claude's next step.</Text> : null}
      </Box>
    )

    // 2. A question for the person: first, whenever there is one. Several questions show as tabs, one at a time.
    const isTabbed = !!a && a.source === 'question' && a.questions.length > 1
    const tab = a ? Math.min(a.tab ?? 0, Math.max(0, a.questions.length - 1)) : 0
    const q = a?.questions[tab]
    const answered = a ? a.questions.filter((_, i) => (a.picks[i] ?? []).length > 0).length : 0
    const card = a && q ? (
      <Box key="ask" flexDirection="column" borderStyle="round" borderColor={PAL.now} paddingX={1} paddingY={1} marginTop={1} gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text bold color={PAL.now}>{isTabbed ? `${a.questions.length} questions` : q.header || (a.source === 'reply' ? 'Claude asked' : 'Question')}</Text>
          <Button key={`${a.id}-skip`} plain dimColor onPress={() => update($, ask, () => null)}>Dismiss</Button>
        </Box>
        {isTabbed ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {a.questions.map((qq, qi) => {
              const done = (a.picks[qi] ?? []).length > 0
              return (
                <Button key={`${a.id}-tab-${qi}`} plain dimColor={qi !== tab} onPress={() => update($, ask, cur => (cur ? { ...cur, tab: qi } : cur))}>
                  <Text color={done ? PAL.done : undefined}>{done ? '✓' : qi + 1} </Text>
                  <Text bold={qi === tab} underline={qi === tab} color={qi === tab ? PAL.now : undefined}>{qq.header || `Question ${qi + 1}`}</Text>
                </Button>
              )
            })}
          </Box>
        ) : null}
        <Box key={`${a.id}-q${tab}`} flexDirection="column" gap={1}>
          <Text bold wrap="wrap">{q.question}</Text>
          {q.multiSelect ? <Text dimColor>Pick one or more.</Text> : null}
          {/* Short answers with nothing to explain (Yes, No) sit side by side; the rest stack with their descriptions. */}
          <Box flexDirection={q.options.every(o => !o.description && o.label.length <= 24) ? 'row' : 'column'} flexWrap="wrap" gap={1}>
          {q.options.map((o, oi) => {
            const picked = (a.picks[tab] ?? []).includes(o.label)
            const isRecommended = /\(recommended\)\s*$/i.test(o.label)
            return (
              <Box key={`${a.id}-${tab}-${oi}`} flexDirection="column">
                <Button
                  key={`${a.id}-${tab}-${oi}-pick`}
                  variant={picked ? 'primary' : 'secondary'}
                  dimColor={isVscode && !picked}
                  hotkey={oi < 9 ? String(oi + 1) : undefined}
                  onPress={async () => {
                    const cur = await read($, ask)
                    if (!cur) return
                    if (cur.source !== 'question') {
                      await send($, o.message ?? o.label)
                      return
                    }
                    const picks = cur.picks.map((row, i) =>
                      i !== tab ? row : q.multiSelect ? (row.includes(o.label) ? row.filter(l => l !== o.label) : [...row, o.label]) : [o.label],
                    )
                    const fresh = { ...cur, picks }
                    if (cur.questions.length === 1 && !q.multiSelect) {
                      await send($, answerText(fresh))
                      return
                    }
                    // A single pick moves on to the next question still open.
                    const open = picks.findIndex(row => row.length === 0)
                    await update($, ask, () => ({ ...fresh, tab: !q.multiSelect && open >= 0 ? open : tab }))
                  }}
                >
                  {q.multiSelect ? (picked ? '☑ ' : '☐ ') : picked ? '● ' : '○ '}
                  {o.label.replace(/\s*\(recommended\)\s*$/i, '')}
                  {isRecommended ? <Text color={PAL.now}> · Recommended</Text> : null}
                </Button>
                {o.description ? <Box paddingLeft={2}><Text dimColor wrap="wrap">{o.description}</Text></Box> : null}
              </Box>
            )
          })}
          </Box>
        </Box>
        {a.source === 'question' && (isTabbed || q.multiSelect) ? (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Text dimColor>{isTabbed ? `${answered} of ${a.questions.length} answered` : ''}</Text>
            <Button key={`${a.id}-send`} variant="primary" onPress={async () => {
              const cur = await read($, ask)
              if (!cur) return
              const open = cur.questions.findIndex((_, i) => (cur.picks[i] ?? []).length === 0)
              if (open >= 0 && cur.questions.length > 1) {
                await update($, ask, () => ({ ...cur, tab: open }))
                $.ui.toast(`Answer "${cur.questions[open]?.header || `question ${open + 1}`}" first, or type your own reply.`)
                return
              }
              await send($, answerText(cur))
            }}>Send answers</Button>
          </Box>
        ) : null}
        {Input ? (
          <Input
            key={`${a.id}-own`}
            placeholder={q.options.length ? 'Or type your answer' : 'Type your reply'}
            submitLabel="Send"
            onSubmit={async (value: string) => {
              const cur = await read($, ask)
              if (cur && value.trim()) await send($, answerText(cur, value.trim()))
            }}
          />
        ) : null}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button key={`${a.id}-later`} plain dimColor onPress={() => decideLater($)}>Decide later · save checkpoint</Button>
          {a.source === 'question' ? (
            <Button key="mode" plain dimColor onPress={async () => {
              const nextMode = (await read($, mode)) === 'panel' ? 'dialog' : 'panel'
              await update($, mode, () => nextMode)
              await $.store.set('mode', nextMode).catch(() => undefined)
            }}>{m === 'panel' ? 'Ask me in the usual dialog instead' : 'Ask me here in the panel'}</Button>
          ) : null}
        </Box>
      </Box>
    ) : null

    // 3. Finished: a copyable recap leads. Three kinds: summary, what changed, what's next.
    const otherKinds = SUMMARY_KINDS.filter(k => k !== sum?.kind)
    const summaryCard = sum && state !== 'ask' ? (
      <Box key="summary" flexDirection="column" borderStyle="round" borderColor={PAL.done} paddingX={1} marginTop={1}>
        {sum.status === 'offer' ? (
          <Box flexDirection="column">
            <Text bold>Want a recap?</Text>
            <Text dimColor>Pick one. You can copy it anywhere.</Text>
            {lastCp ? (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Text dimColor>Covers: {scopeNow === 'since' ? `the work since the checkpoint at ${clock(lastCp.at).slice(0, 5)}` : 'the whole session'}</Text>
                <Button key="sum-scope" plain dimColor onPress={() => update($, recapScope, v => (v === 'since' ? 'all' : 'since'))}>
                  {scopeNow === 'since' ? 'Use the whole session' : 'Use since the last checkpoint'}
                </Button>
              </Box>
            ) : null}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="sum-summary" variant="primary" onPress={() => writeSummary($, 'summary')}>Summary</Button>
              <Button key="sum-changes" dimColor={isVscode} onPress={() => writeSummary($, 'changes')}>What changed</Button>
              <Button key="sum-next" dimColor={isVscode} onPress={() => writeSummary($, 'next')}>What's next</Button>
              <Button key="sum-no" dimColor onPress={() => update($, summary, () => null)}>Not now</Button>
            </Box>
          </Box>
        ) : null}
        {sum.status === 'loading' ? <Text color={PAL.now}>Writing: {SUMMARY_LABEL[sum.kind]}…</Text> : null}
        {sum.status === 'ready' || sum.status === 'error' ? (
          <Box flexDirection="column">
            <Text bold>{SUMMARY_LABEL[sum.kind]}</Text>
            {lastCp ? <Text dimColor>{sum.scope === 'since' ? `Covers the work since the checkpoint at ${clock(lastCp.at).slice(0, 5)}.` : 'Covers the whole session.'}</Text> : null}
            {sum.status === 'ready' ? <Markdown key="sum-text" text={sum.text} /> : <Text color={PAL.failed}>{sum.text}</Text>}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {sum.status === 'ready' ? <Button key="sum-copy" variant="primary" onPress={press => copySummary($, press.surface)}>Copy</Button> : null}
              {sum.status === 'ready' ? <Button key="sum-full" dimColor={isVscode} onPress={() => openRecap($)}>Open full view</Button> : null}
              <Button key="sum-again" dimColor={isVscode} onPress={() => writeSummary($, sum.kind, sum.scope)}>{sum.status === 'error' ? 'Try again' : 'Rewrite'}</Button>
              {lastCp && sum.scope === 'since' ? <Button key="sum-whole" dimColor={isVscode} onPress={() => writeSummary($, sum.kind, 'all')}>Whole session</Button> : null}
              {otherKinds.map(k => (
                <Button key={`sum-${k}`} dimColor={isVscode} onPress={() => writeSummary($, k, sum.scope)}>{SUMMARY_LABEL[k]}</Button>
              ))}
              <Button key="sum-close" dimColor onPress={() => update($, summary, () => null)}>Close</Button>
            </Box>
          </Box>
        ) : null}
      </Box>
    ) : null

    // 4. Progress: a rail with one segment per step (hover a segment for its name), then Now / Next / time left.
    const rail = (key: string, steps: Step[]) => {
      const drawn = Svg ? railSvg(steps, BAR_WIDTH) : undefined
      if (Svg && drawn) {
        return (
          <Box key={`${key}-drawing`} flexDirection="column">
            <Svg source={drawn.source} alt={drawn.alt} height={drawn.height} isInteractive />
          </Box>
        )
      }
      return (
        <Text key={`${key}-rail`}>
          {steps.slice(0, 60).map((s, i) => (
            <Text key={`${key}r${i}`} color={s.status === 'done' ? PAL.done : s.status === 'active' ? PAL.now : s.status === 'failed' ? PAL.failed : PAL.waiting}>
              {s.status === 'done' ? '█' : s.status === 'active' ? '●' : s.status === 'failed' ? '✕' : '░'}
            </Text>
          ))}
        </Text>
      )
    }
    const progress = (key: string, title: string, steps: Step[], compact: boolean, note?: string) => {
      if (steps.length === 0) return null
      const done = steps.filter(s => s.status === 'done').length
      const activeAt = steps.findIndex(s => s.status === 'active')
      const active = steps[activeAt]
      const nextStep = steps.find((s, i) => i > activeAt && s.status === 'pending')
      const left = timeLeft(steps, now)
      const toGo = steps.length - done
      return (
        <Box key={key} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text bold>{title}</Text>
            <Text dimColor>{done} of {steps.length} steps{toGo ? ` · ${toGo} left` : ' · all done'}</Text>
          </Box>
          {note ? <Text dimColor>{note}</Text> : null}
          {rail(key, steps)}
          {active ? (
            <Text wrap="truncate-end">
              <Text color={PAL.now} bold>Now: </Text>
              {active.title}
              {!compact && active.startedAt !== undefined ? <Text color={PAL.now}> · {duration(now - active.startedAt)}</Text> : null}
            </Text>
          ) : null}
          {!compact && nextStep ? <Text dimColor wrap="truncate-end">Next: {nextStep.title}</Text> : null}
          {!compact && left !== undefined ? <Text dimColor>About {duration(left)} left</Text> : null}
        </Box>
      )
    }

    // At a glance: a ring of the steps done, the share in big type, time so far and left, then what runs now.
    const ring = (steps: Step[], title: string) => {
      if (steps.length === 0) return null
      const done = steps.filter(s => s.status === 'done').length
      const activeAt = steps.findIndex(s => s.status === 'active')
      const active = steps[activeAt]
      const nextStep = steps.find((s, i) => i > activeAt && s.status === 'pending')
      const left = state === 'working' ? timeLeft(steps, now) : undefined
      const began = Math.min(...steps.map(s => s.startedAt ?? Infinity), t.startedAt || Infinity)
      const spent = Number.isFinite(began) ? (t.isRunning ? now : t.endedAt || now) - began : 0
      const changed = places(list).filter(pl => pl.creates + pl.edits > 0).length
      const size = Math.min(96, Math.round(px * 0.3))
      const drawn = Svg ? ringSvg(steps, size) : undefined
      return (
        <Box key="ring" flexDirection="column" marginTop={1} gap={1}>
          <Text dimColor wrap="truncate-end">{title}</Text>
          <Box flexDirection="row" alignItems="center" gap={2}>
            {Svg && drawn ? <Svg key="ring-drawing" source={drawn.source} alt={drawn.alt} width={size} height={size} /> : null}
            <Box flexDirection="column">
              <Text size="title" weight="semibold" tabular>{Math.round((done / steps.length) * 100)}%</Text>
              {Svg ? null : <Text color={PAL.done}>{railText(steps)}</Text>}
              <Text dimColor>{done} of {steps.length} steps{left !== undefined ? ` · about ${duration(left)} left` : ''}</Text>
              <Text dimColor tabular>{duration(spent)} so far{changed ? ` · ${changed} file${changed === 1 ? '' : 's'} changed` : ''}</Text>
            </Box>
          </Box>
          {active ? (
            <Text weight="semibold" wrap="wrap">
              <Text color={PAL.now}>Now: </Text>
              {active.title}
              {active.startedAt !== undefined ? <Text color={PAL.now} tabular> · {duration(now - active.startedAt)}</Text> : null}
            </Text>
          ) : null}
          {nextStep ? <Text dimColor wrap="truncate-end">Then: {nextStep.title}</Text> : null}
        </Box>
      )
    }

    // Claude in its own words: the latest line, with what it does this second above it, and the two before.
    const thisTurn = lines.filter(n => n.at >= t.startedAt)
    const latest = thisTurn.at(-1)
    const narrationBlock = (
      <Box key="narration" flexDirection="column" marginTop={1}>
        <Box flexDirection="column" borderStyle="round" borderColor={PAL.waiting} paddingX={1}>
          <Text color={PAL.now}>● {nowDoing(list)}</Text>
          {latest ? <Text wrap="wrap">{latest.text}</Text> : null}
        </Box>
        {thisTurn.slice(-3, -1).reverse().map(n => (
          <Text key={`said-${n.at}`} dimColor wrap="wrap">{clock(n.at).slice(0, 5)}  {n.text}</Text>
        ))}
      </Box>
    )

    // Work in the background: each task's timer, and its latest action as proof it still works.
    const bgLine = (b: BgTask) => {
      if (b.status !== 'running') return `${b.status === 'done' ? 'Finished' : b.status === 'failed' ? 'Failed' : 'Stopped'}${b.actions ? ` · ${b.actions} actions` : ''}`
      if (b.lastAt === undefined) return b.kind === 'shell' ? `Started ${clock(b.startedAt).slice(0, 5)}` : 'Starting'
      return `${b.lastAction} · ${duration(now - b.lastAt)} ago · ${b.actions} actions`
    }
    const bgBlock = bg.length === 0 ? null : (
      <Box key="bg" flexDirection="column" marginTop={1}>
        <Text bold>{bgRunning ? `Running in the background · ${bgRunning}` : 'Background work'}</Text>
        {[...bg].reverse().map(b => {
          const isRunning = b.status === 'running'
          const isQuiet = isRunning && quietFor(b, now) > QUIET_AFTER
          const color = isRunning ? PAL.now : b.status === 'done' ? PAL.done : b.status === 'failed' ? PAL.failed : PAL.waiting
          return (
            <Box key={`bg-${b.id}`} flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text wrap="truncate-end" bold={isRunning} dimColor={!isRunning}>
                  <Text color={color}>{isRunning ? '●' : b.status === 'done' ? '✓' : b.status === 'failed' ? '✕' : '■'} </Text>
                  {b.kind === 'shell' ? 'Command: ' : ''}{b.title}
                </Text>
                <Text dimColor tabular>{duration((b.endedAt ?? now) - b.startedAt)}</Text>
              </Box>
              <Text wrap="truncate-end" dimColor={!isQuiet} color={isQuiet ? TONE.slow : undefined}>
                {'  '}{bgLine(b)}{isQuiet ? ' · quiet for a while' : ''}
              </Text>
            </Box>
          )
        })}
      </Box>
    )

    // Where the time went, step by step: done steps with how long they took, the one now with its running time.
    const stepsList = (steps: Step[]) => {
      if (steps.length === 0) return null
      const activeAt = steps.findIndex(s => s.status === 'active')
      const from = Math.max(0, Math.min((activeAt < 0 ? steps.length : activeAt) - 4, steps.length - 10))
      return (
        <Box key="steps" flexDirection="column" marginTop={1}>
          <Text bold>Steps</Text>
          {from > 0 ? <Text dimColor>{from} earlier steps done</Text> : null}
          {steps.slice(from, from + 10).map((s, i) => {
            const took =
              s.status === 'done' && s.startedAt !== undefined && s.doneAt !== undefined ? duration(s.doneAt - s.startedAt)
                : s.status === 'active' && s.startedAt !== undefined ? duration(now - s.startedAt)
                  : ''
            const color = s.status === 'done' ? PAL.done : s.status === 'active' ? PAL.now : s.status === 'failed' ? PAL.failed : undefined
            return (
              <Box key={`step-${from + i}`} flexDirection="row" justifyContent="space-between" gap={1}>
                <Text wrap="truncate-end" dimColor={s.status === 'pending'} bold={s.status === 'active'}>
                  <Text color={color}>{s.status === 'done' ? '✓' : s.status === 'active' ? '●' : s.status === 'failed' ? '✕' : '○'} </Text>
                  {s.title}
                </Text>
                <Text dimColor tabular>{took}</Text>
              </Box>
            )
          })}
          {steps.length > from + 10 ? <Text dimColor>and {steps.length - from - 10} more</Text> : null}
        </Box>
      )
    }

    // 5. Activity: where the time went, then the latest actions; click one for everything about it.
    const shares = activityShares(list)
    const total = shares.reduce((sum, x) => sum + x.ms, 0)
    const drawnActivity = Svg && shares.length ? activitySvg(shares, BAR_WIDTH) : undefined
    const rowsShown = expanded ? 20 : 4
    const recent = list.slice(-rowsShown).reverse()
    const barWidth = Math.max(10, Math.min(40, cols - 4))
    const detail = (c: Call) => (
      <Box key={`detail-${c.id}`} flexDirection="column" borderStyle="round" borderColor={PAL.waiting} paddingX={1}>
        <Text bold>{c.isHelper ? 'Helper: ' : ''}{c.label}</Text>
        <Text dimColor>
          {c.endedAt === undefined ? 'Still running' : c.isError ? 'Failed' : 'Finished'} · started {clock(c.startedAt)} · {duration((c.endedAt ?? now) - c.startedAt)}
        </Text>
        {c.input ? <Text dimColor>What it was given</Text> : null}
        {c.input ? <Code source={c.input} language={c.kind === 'run' ? 'bash' : 'json'} /> : null}
        {c.output ? <Text dimColor>{c.isError ? 'What went wrong' : 'What came back (start)'}</Text> : null}
        {c.output ? <Code source={c.output} language="text" /> : null}
        {!c.output && c.endedAt === undefined ? <Text dimColor>Its result will show here when it finishes.</Text> : null}
      </Box>
    )
    // One clickable line per action; click it to open its detail beneath. `scope` keeps keys apart where a call shows twice.
    const actionRow = (c: Call, scope: string) => (
      <Box key={`${scope}-row-${c.id}`} flexDirection="column">
        <Button key={`${scope}-call-${c.id}`} plain dimColor={c.endedAt !== undefined && !c.isError} onPress={() => update($, openCall, cur => (cur === c.id ? '' : c.id))}>
          <Text color={c.endedAt === undefined ? PAL.now : c.isError ? PAL.failed : PAL.done}>{c.endedAt === undefined ? '●' : c.isError ? '✕' : '✓'} </Text>
          {c.isHelper ? 'Helper: ' : ''}{c.label}
          {c.detail ? <Text dimColor> · {clip(c.detail, Math.max(10, cols - c.label.length - 18))}</Text> : null}
          <Text dimColor> {duration((c.endedAt ?? now) - c.startedAt)} {open === c.id ? '▾' : '▸'}</Text>
        </Button>
        {open === c.id ? detail(c) : null}
      </Box>
    )
    const activity = (
      <Box key="activity" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>Activity</Text>
          <Text dimColor>last 10 min</Text>
        </Box>
        {drawnActivity && Svg ? (
          <Box key="activity-drawing" flexDirection="column">
            <Svg source={drawnActivity.source} alt={drawnActivity.alt} height={drawnActivity.height} isInteractive />
          </Box>
        ) : shares.length ? (
          <Text>
            {shares.map(x => (
              <Text key={`bar-${x.kind}`} color={x.color}>{'█'.repeat(Math.max(1, Math.round((x.ms / total) * barWidth)))}</Text>
            ))}
          </Text>
        ) : null}
        {shares.length ? (
          <Text wrap="wrap">
            {shares.map((x, i) => (
              <Text key={`legend-${x.kind}`}>
                {i ? '  ' : ''}<Text color={x.color}>■</Text> <Text dimColor>{x.label} {Math.round((x.ms / total) * 100)}%</Text>
              </Text>
            ))}
          </Text>
        ) : (
          <Text dimColor>Nothing yet. Actions show here as Claude works.</Text>
        )}
        {recent.map(c => actionRow(c, 'recent'))}
        {list.length > 4 ? (
          <Button key="more" plain dimColor onPress={() => update($, showDetails, v => !v)}>
            {expanded ? 'Show fewer actions' : `Show all recent actions (${Math.min(list.length, 20)})`}
          </Button>
        ) : null}
      </Box>
    )

    // Where Claude worked: the files it created, edited or read. Click a file for every action on it.
    const where = places(list)
    const changedCount = where.filter(pl => pl.creates + pl.edits > 0).length
    const opened = where.find(pl => pl.path === fileOpen)
    const placeColor = (pl: { creates: number; edits: number }) => (pl.creates ? PAL.done : pl.edits ? '#C9A24A' : '#6E7F8D')
    const whereBlock = where.length ? (
      <Box key="where" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>Where Claude worked</Text>
          <Text dimColor>{changedCount} changed · {where.length - changedCount} read</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {where.slice(0, 10).map(pl => (
            <Button key={`place-${pl.path}`} plain dimColor onPress={() => update($, openFile, cur => (cur === pl.path ? '' : pl.path))}>
              <Text color={placeColor(pl)}>{pl.creates ? '+' : pl.edits ? '✎' : '○'}</Text> {pl.name}
              {pl.creates + pl.edits > 1 ? <Text dimColor> ×{pl.creates + pl.edits}</Text> : null}
            </Button>
          ))}
        </Box>
        {where.length > 10 ? <Text dimColor>and {where.length - 10} more</Text> : null}
        <Text dimColor size="footnote">+ created  ✎ edited  ○ read</Text>
        {opened ? (
          <Box key="file-detail" flexDirection="column" borderStyle="round" borderColor={placeColor(opened)} paddingX={1}>
            <Text bold>{opened.name}</Text>
            <Text dimColor wrap="wrap">{opened.path}</Text>
            <Text dimColor>
              {[opened.creates ? `created ${opened.creates}×` : '', opened.edits ? `edited ${opened.edits}×` : '', opened.reads ? `read ${opened.reads}×` : ''].filter(Boolean).join(' · ')}
            </Text>
            {list.filter(c => c.target === opened.path).slice(-8).reverse().map(c => actionRow(c, 'file'))}
          </Box>
        ) : null}
      </Box>
    ) : null

    // Checkpoints: pause and save where things stand, recap just that section, pick it up later.
    const railText = (steps: { status: string }[]) =>
      steps.slice(0, 40).map(st => (st.status === 'done' ? '█' : st.status === 'active' ? '●' : st.status === 'failed' ? '✕' : '░')).join('')
    // A decision left for later: the question, its options, and one button per option to continue with it.
    const choicesOf = (cp: Checkpoint) => (cp.pending?.length === 1 ? cp.pending[0]!.options : [])
    // The menu's times, with one set by /live autosave that the menu does not offer put in its place, before Off.
    const everyMin = Math.round(every / 60_000)
    const everyChoices = AUTOSAVE_CHOICES.includes(everyMin) ? AUTOSAVE_CHOICES : [...AUTOSAVE_CHOICES.filter(m => m > 0), everyMin].sort((x, y) => x - y).concat(0)
    const decision = (cp: Checkpoint, where: string) => {
      const open = cp.pending ?? []
      if (open.length === 0) return null
      const options = choicesOf(cp)
      const pick = options.findIndex(o => /\(recommended\)\s*$/i.test(o.label))
      return (
        <Box key={`${where}-decide-${cp.id}`} flexDirection="column" gap={1} marginTop={1}>
          <Text bold color={PAL.now}>{open.length > 1 ? 'Decisions to make' : 'Decision to make'}</Text>
          {open.map((q, qi) => (
            <Text key={`${where}-q-${cp.id}-${qi}`} wrap="wrap">{q.question}</Text>
          ))}
          {options.map((o, oi) => {
            const label = o.label.replace(/\s*\(recommended\)\s*$/i, '')
            const isMain = oi === (pick >= 0 ? pick : 0)
            return (
              <Box key={`${where}-opt-${cp.id}-${oi}`} flexDirection="column">
                <Button key={`${where}-go-${cp.id}-${oi}`} variant={isMain ? 'primary' : 'secondary'} dimColor={isVscode && !isMain} onPress={() => continueFrom($, cp, label)}>
                  Continue with {label}
                  {oi === pick ? <Text color={PAL.now}> · Recommended</Text> : null}
                </Button>
                {o.description ? <Box paddingLeft={2}><Text dimColor wrap="wrap">{o.description}</Text></Box> : null}
              </Box>
            )
          })}
        </Box>
      )
    }
    const continueLabel = (cp: Checkpoint) => (cp.pending?.length ? 'Continue and ask me again' : 'Continue from here')
    const cpDetail = (cp: Checkpoint) => (
      <Box key={`cp-detail-${cp.id}`} flexDirection="column" borderStyle="round" borderColor={cp.status === 'error' ? PAL.failed : PAL.done} paddingX={1}>
        {cp.status === 'writing' ? <Text color={PAL.now}>Writing the recap for this checkpoint…</Text> : <Markdown key={`cp-text-${cp.id}`} text={cp.summary} />}
        <Text dimColor>Snapshot: {cp.snapshot.health} · {cp.snapshot.steps.filter(st => st.status === 'done').length} of {cp.snapshot.steps.length} steps · {cp.snapshot.actions} actions</Text>
        {cp.snapshot.steps.length ? <Text color={PAL.done}>{railText(cp.snapshot.steps)}</Text> : null}
        {cp.snapshot.filesChanged.length ? <Text dimColor wrap="wrap">Files changed: {cp.snapshot.filesChanged.slice(0, 8).join(', ')}{cp.snapshot.filesChanged.length > 8 ? ' and more' : ''}</Text> : null}
        {decision(cp, 'cp')}
        {cp.status === 'ready' || cp.pending?.length ? (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key={`cp-continue-${cp.id}`} variant={choicesOf(cp).length ? 'secondary' : 'primary'} dimColor={isVscode && choicesOf(cp).length > 0} onPress={() => continueFrom($, cp)}>{continueLabel(cp)}</Button>
            <Button key={`cp-copy-${cp.id}`} dimColor={isVscode} onPress={press => copyText($, cp.summary, press.surface)}>Copy</Button>
          </Box>
        ) : null}
      </Box>
    )
    const cpBlock = (
      <Box key="checkpoints" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>Checkpoints</Text>
          <Text dimColor>{cps.length ? `${cps.length} saved` : 'none yet'}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="cp-save" variant={t.isRunning ? 'primary' : 'secondary'} dimColor={isVscode && !t.isRunning} onPress={() => saveCheckpoint($, t.isRunning)}>
            {t.isRunning ? 'Pause and save checkpoint' : 'Save checkpoint'}
          </Button>
          {Select ? (
            <Select
              key="autosave"
              label="Auto-save"
              value={String(everyMin)}
              options={everyChoices.map(min => ({ value: String(min), label: everyLabel(min * 60_000) }))}
              onSelect={(value: string) => setAutosave($, Number(value) * 60_000)}
            />
          ) : (
            <Text dimColor>Auto-save: {everyLabel(every).toLowerCase()}</Text>
          )}
        </Box>
        {cps.length === 0 ? (
          <Text dimColor wrap="wrap">
            Save a checkpoint to recap this part of the work and continue from it later.
            {every > 0 ? ` The panel also saves one by itself ${everyLabel(every).toLowerCase()} while Claude works, and when a task list is done.` : ''}
          </Text>
        ) : null}
        {[...cps].reverse().slice(0, 4).map(cp => (
          <Box key={`cp-row-${cp.id}`} flexDirection="column">
            <Button key={`cp-${cp.id}`} plain dimColor={isVscode} onPress={() => update($, openCheckpoint, cur => (cur === cp.id ? '' : cp.id))}>
              <Text color={cp.status === 'ready' ? PAL.done : cp.status === 'writing' ? PAL.now : PAL.failed}>◆ </Text>
              #{cps.indexOf(cp) + 1} · {clock(cp.at).slice(0, 5)}
              {cp.isAuto ? <Text dimColor> · Auto</Text> : null}
              <Text dimColor> · {cp.snapshot.steps.filter(st => st.status === 'done').length}/{cp.snapshot.steps.length} steps · {cp.snapshot.filesChanged.length} files changed</Text>
              {cp.pending?.length ? <Text color={PAL.now}> · decision open</Text> : null}
              <Text dimColor> {cpOpen === cp.id ? '▾' : '▸'}</Text>
            </Button>
            {cpOpen === cp.id ? cpDetail(cp) : null}
          </Box>
        ))}
      </Box>
    )
    const resumeCard = back && !t.isRunning ? (
      <Box key="resume" flexDirection="column" borderStyle="round" borderColor={PAL.now} paddingX={1} marginTop={1}>
        <Text bold color={PAL.now}>Last time, you stopped here</Text>
        <Text dimColor>Checkpoint from {new Date(back.at).toDateString().slice(4, 10)} at {clock(back.at).slice(0, 5)}</Text>
        <Markdown key="resume-text" text={back.summary} />
        {decision(back, 'resume')}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="resume-continue" variant={choicesOf(back).length ? 'secondary' : 'primary'} dimColor={isVscode && choicesOf(back).length > 0} onPress={() => continueFrom($, back)}>{continueLabel(back)}</Button>
          <Button key="resume-dismiss" dimColor onPress={() => update($, resume, () => null)}>Dismiss</Button>
        </Box>
      </Box>
    ) : null

    // In the "needs you" and "finished" states activity folds away behind one button.
    const activityToggle = (
      <Box key="toggle-activity-row" flexDirection="row" marginTop={1}>
        <Button key="toggle-activity" plain dimColor onPress={() => update($, showDetails, v => !v)}>
          {expanded ? '▾ Hide what Claude did' : '▸ Show what Claude did'}
        </Button>
      </Box>
    )

    // 6. Talk to Claude without the chat.
    const talk = (
      <Box key="talk" flexDirection="column" marginTop={1}>
        {Input ? (
          <Input
            key="message"
            placeholder={t.isRunning ? 'Message Claude… (sent when it finishes its reply)' : 'Message Claude…'}
            submitLabel="Send"
            onSubmit={(value: string) => send($, value)}
          />
        ) : null}
        {last ? <Text dimColor wrap="truncate-end">You sent: {last}</Text> : null}
        {t.isRunning ? (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="stop" dimColor onPress={async () => {
              const cur = await read($, turn)
              if (cur.isRunning && cur.turnId) await $.turn.abort({ turnId: cur.turnId }).catch(() => undefined)
            }}>Stop Claude</Button>
          </Box>
        ) : null}
      </Box>
    )

    const script = f.path !== '' ? progress('feed', `Script: ${f.title || f.path}`, f.steps, state !== 'working', f.error ? `Following ${f.path} (${f.error})` : undefined) : null
    const planBlock = progress('plan', p.title || 'Progress', p.steps, state !== 'working')

    if (state === 'idle' && !planBlock && !script && list.length === 0) {
      return (
        <Box flexDirection="column">
          {header}
          {bgBlock}
          {resumeCard}
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Ready when you are</Text>
            <Text dimColor>Send a message to start. Progress, activity and any questions for you will show here.</Text>
          </Box>
          {summaryCard}
          {talk}
        </Box>
      )
    }
    if (state === 'ask') {
      return (
        <Box flexDirection="column">
          {header}
          {card}
          {bgBlock}
          {planBlock}
          {script}
          {activityToggle}
          {expanded ? activity : null}
        </Box>
      )
    }
    if (state === 'finished') {
      return (
        <Box flexDirection="column">
          {header}
          <Box key="finished" flexDirection="column" marginTop={1}>
            {bgRunning ? (
              <Text bold color={PAL.now}>Waiting on background work · Claude's turn took {duration(t.endedAt - t.startedAt)}</Text>
            ) : (
              <Text bold color={PAL.done}>Task finished · {duration(t.endedAt - t.startedAt)}</Text>
            )}
          </Box>
          {bgBlock}
          {resumeCard}
          {summaryCard}
          {ring(p.steps, p.title || 'Progress')}
          {stepsList(p.steps)}
          {cpBlock}
          {whereBlock}
          {script}
          {activityToggle}
          {expanded ? activity : null}
          {talk}
        </Box>
      )
    }
    // Working: the ring and Claude's own words first; files and raw actions fold away behind one button.
    return (
      <Box flexDirection="column">
        {header}
        {ring(p.steps, p.title || 'Progress')}
        {narrationBlock}
        {bgBlock}
        {stepsList(p.steps)}
        {script}
        {cpBlock}
        {activityToggle}
        {expanded ? whereBlock : null}
        {expanded ? activity : null}
        {summaryCard}
        {talk}
      </Box>
    )
  })
}
