import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, Call, EffortLevel, Engine, Feed, Plan, QuestionMode, Step, Summary, SummaryKind, Turn } from '../types'
import type { Tone } from './model'
import {
  activityShares,
  answerText,
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
  PAL,
  parseFeed,
  parseQuestions,
  planFromTool,
  replyFromText,
  places,
  SUMMARY_KINDS,
  SUMMARY_LABEL,
  SUMMARY_PROMPTS,
  timeLeft,
} from './model'
import { activitySvg, railSvg } from './svg'

const PANE = 'live-view'
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

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

/** Sends text to Claude as the person's own words, and clears the card it answered. */
async function send($: EngineInterface, text: string): Promise<void> {
  const body = text.trim()
  if (body === '') return
  await update($, ask, () => null)
  await update($, sent, () => clip(body, 200))
  await $.prompt.submit({ text: body, asUser: true })
}

/** Asks Claude, off to the side, for a recap of this session: a summary, what changed, or what's next. */
async function writeSummary($: EngineInterface, kind: SummaryKind): Promise<void> {
  const at = Date.now()
  await update($, summary, () => ({ kind, status: 'loading', text: '', at }))
  const reply = await $.model.fork({ prompt: SUMMARY_PROMPTS[kind] }).catch(() => undefined)
  const text = reply?.isAnswered ? reply.text.trim() : ''
  const why = reply && !reply.isAnswered ? ` (${reply.reason})` : ''
  await update($, summary, (cur): Summary | null =>
    cur && cur.at === at
      ? { ...cur, status: text ? 'ready' : 'error', text: text || `Couldn't write it this time${why}. Try again in a moment.` }
      : cur,
  )
}

/** Copies the summary; where the surface can't, puts it in the message box to copy from there. */
async function copySummary($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const cur = await read($, summary)
  if (!cur?.text) return
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'live',
      description: 'Open the Live panel: progress, what Claude is doing, effort level, and questions for you',
      argumentHint: '[effort low|medium|high|xhigh|max|session | summary [changes|next] | summaries on|off | watch <file> | unwatch | questions panel|dialog]',
    })
    const savedMode = await $.store.get('mode').catch(() => undefined)
    if (savedMode === 'panel' || savedMode === 'dialog') await update($, mode, () => savedMode)
    const savedEffort = await $.store.get('effortChoice').catch(() => undefined)
    if (typeof savedEffort === 'string' && (savedEffort === '' || (LEVELS as string[]).includes(savedEffort))) {
      await update($, effortChoice, () => savedEffort as EffortLevel | '')
    }
    const savedFeed = await $.store.get('feedPath').catch(() => undefined)
    if (typeof savedFeed === 'string' && savedFeed !== '') await update($, feed, () => ({ ...EMPTY_FEED, path: savedFeed, error: 'waiting for the file' }))
    const autoOpen = await $.store.get('autoOpen').catch(() => undefined)
    if (autoOpen !== false) void openPane($)

    // The live loop: follow a progress file, and keep timers ticking while work runs.
    let lastText = ''
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
      if (t.isRunning || active) await update($, tick, () => Date.now())
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
    if (verb === 'summary' && (arg === '' || arg === 'changes' || arg === 'next')) {
      await openPane($)
      void writeSummary($, arg === '' ? 'summary' : arg)
      return { text: 'Writing it in the Live panel.' }
    }
    if (verb === 'autoopen' && (arg === 'on' || arg === 'off')) {
      await $.store.set('autoOpen', arg === 'on').catch(() => undefined)
      return { text: `The Live panel will ${arg === 'on' ? '' : 'not '}open by itself when a session starts.` }
    }
    await openPane($)
    return { text: 'Live panel opened.' }
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
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
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
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Code } = els
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
    await read($, tick)
    const now = Date.now()
    const cols = Math.max(28, (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 48)
    const px = Math.round(Math.min(560, Math.max(260, cols * 7.4)))

    const state: 'ask' | 'working' | 'finished' | 'idle' = a ? 'ask' : t.isRunning ? 'working' : t.endedAt ? 'finished' : 'idle'
    const signal = health({ hasAsk: !!a, isRunning: t.isRunning, hadTurn: t.endedAt > 0, steps: p.steps, calls: list }, now)
    const tone = TONE[signal.tone]

    // 1. Health, time, model and effort: always on top.
    const model = eng.model || t.model
    const effortNow = eng.effort ? (EFFORT_LABEL[eng.effort] ?? eng.effort) : ''
    const timeText = t.isRunning ? `Working · ${duration(now - t.startedAt)}` : t.endedAt ? `Last reply took ${duration(t.endedAt - t.startedAt)}` : 'Idle'
    const header = (
      <Box key="hdr" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Box borderStyle="round" borderColor={tone} paddingX={1}>
            <Text bold color={tone}>● {signal.label}</Text>
          </Box>
          <Text dimColor>{timeText}</Text>
        </Box>
        {signal.note ? <Text dimColor wrap="wrap">{signal.note}</Text> : null}
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {model ? <Text dimColor>{model}</Text> : null}
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

    // 2. A question for the person: first, whenever there is one.
    const card = a ? (
      <Box key="ask" flexDirection="column" borderStyle="round" borderColor={PAL.now} paddingX={1} marginTop={1}>
        <Text bold color={PAL.now}>Claude needs you</Text>
        {a.questions.map((q, qi) => (
          <Box key={`q${qi}`} flexDirection="column" marginTop={qi === 0 ? 0 : 1}>
            {q.header ? <Text dimColor>{q.header}</Text> : null}
            <Text bold>{q.question}</Text>
            {q.multiSelect ? <Text dimColor>Pick one or more, then Send answers.</Text> : null}
            {q.options.map((o, oi) => {
              const picked = (a.picks[qi] ?? []).includes(o.label)
              return (
                <Button
                  key={`${a.id}-${qi}-${oi}`}
                  variant={picked ? 'primary' : 'secondary'}
                  onPress={async () => {
                    const cur = await read($, ask)
                    if (!cur) return
                    if (cur.source !== 'question') {
                      await send($, o.message ?? o.label)
                      return
                    }
                    const picks = cur.picks.map((row, i) =>
                      i !== qi ? row : q.multiSelect ? (row.includes(o.label) ? row.filter(l => l !== o.label) : [...row, o.label]) : [o.label],
                    )
                    const fresh = { ...cur, picks }
                    const isSingleAndComplete = cur.questions.every(qq => !qq.multiSelect) && picks.every(row => row.length > 0)
                    if (isSingleAndComplete) await send($, answerText(fresh))
                    else await update($, ask, () => fresh)
                  }}
                >
                  {picked ? '✓ ' : ''}{o.label}
                  {o.description ? <Text dimColor> · {o.description}</Text> : null}
                </Button>
              )
            })}
          </Box>
        ))}
        {a.source === 'question' && (a.questions.length > 1 || a.questions.some(q => q.multiSelect)) ? (
          <Button key={`${a.id}-send`} variant="primary" onPress={async () => {
            const cur = await read($, ask)
            if (cur) await send($, answerText(cur))
          }}>Send answers</Button>
        ) : null}
        {Input ? (
          <Input
            key={`${a.id}-own`}
            placeholder={a.questions[0]?.options.length ? 'Or type your own answer' : 'Type your reply'}
            submitLabel="Send"
            onSubmit={async (value: string) => {
              const cur = await read($, ask)
              if (cur && value.trim()) await send($, answerText(cur, value.trim()))
            }}
          />
        ) : null}
        <Button key={`${a.id}-skip`} dimColor onPress={() => update($, ask, () => null)}>Dismiss</Button>
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
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="sum-summary" variant="primary" onPress={() => writeSummary($, 'summary')}>Summary</Button>
              <Button key="sum-changes" onPress={() => writeSummary($, 'changes')}>What changed</Button>
              <Button key="sum-next" onPress={() => writeSummary($, 'next')}>What's next</Button>
              <Button key="sum-no" dimColor onPress={() => update($, summary, () => null)}>Not now</Button>
            </Box>
          </Box>
        ) : null}
        {sum.status === 'loading' ? <Text color={PAL.now}>Writing: {SUMMARY_LABEL[sum.kind]}…</Text> : null}
        {sum.status === 'ready' || sum.status === 'error' ? (
          <Box flexDirection="column">
            <Text bold>{SUMMARY_LABEL[sum.kind]}</Text>
            {sum.status === 'ready' ? <Code source={sum.text} language="markdown" /> : <Text color={PAL.failed}>{sum.text}</Text>}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {sum.status === 'ready' ? <Button key="sum-copy" variant="primary" onPress={press => copySummary($, press.surface)}>Copy</Button> : null}
              <Button key="sum-again" onPress={() => writeSummary($, sum.kind)}>{sum.status === 'error' ? 'Try again' : 'Rewrite'}</Button>
              {otherKinds.map(k => (
                <Button key={`sum-${k}`} onPress={() => writeSummary($, k)}>{SUMMARY_LABEL[k]}</Button>
              ))}
              <Button key="sum-close" dimColor onPress={() => update($, summary, () => null)}>Close</Button>
            </Box>
          </Box>
        ) : null}
      </Box>
    ) : null

    // 4. Progress: a rail with one segment per step (hover a segment for its name), then Now / Next / time left.
    const rail = (key: string, steps: Step[]) => {
      const drawn = Svg ? railSvg(steps, px) : undefined
      if (Svg && drawn) {
        return (
          <Box key={`${key}-drawing`} flexDirection="column">
            <Svg source={drawn.source} alt={drawn.alt} width={px} height={drawn.height} isInteractive />
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
              {active.startedAt !== undefined ? <Text color={PAL.now}> · {duration(now - active.startedAt)}</Text> : null}
            </Text>
          ) : null}
          {!compact && nextStep ? <Text dimColor wrap="truncate-end">Next: {nextStep.title}</Text> : null}
          {!compact && left !== undefined ? <Text dimColor>About {duration(left)} left</Text> : null}
        </Box>
      )
    }

    // 5. Activity: where the time went, then the latest actions; click one for everything about it.
    const shares = activityShares(list)
    const total = shares.reduce((sum, x) => sum + x.ms, 0)
    const drawnActivity = Svg && shares.length ? activitySvg(shares, px) : undefined
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
            <Svg source={drawnActivity.source} alt={drawnActivity.alt} width={px} height={drawnActivity.height} isInteractive />
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
        <Text dimColor>Click an action to see exactly what ran and what came back.</Text>
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
            <Button key={`place-${pl.path}`} plain onPress={() => update($, openFile, cur => (cur === pl.path ? '' : pl.path))}>
              <Text color={placeColor(pl)}>{pl.creates ? '+' : pl.edits ? '✎' : '○'}</Text> {pl.name}
              {pl.creates + pl.edits > 1 ? <Text dimColor> ×{pl.creates + pl.edits}</Text> : null}
            </Button>
          ))}
        </Box>
        {where.length > 10 ? <Text dimColor>and {where.length - 10} more</Text> : null}
        <Text dimColor>+ created  ✎ edited  ○ read. Click a file to see what Claude did with it.</Text>
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

    // In the "needs you" and "finished" states activity folds away behind one button.
    const activityToggle = (
      <Button key="toggle-activity" plain dimColor onPress={() => update($, showDetails, v => !v)}>
        {expanded ? 'Hide what Claude did' : 'Show what Claude did'}
      </Button>
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
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {t.isRunning ? (
            <Button key="stop" onPress={async () => {
              const cur = await read($, turn)
              if (cur.isRunning && cur.turnId) await $.turn.abort({ turnId: cur.turnId }).catch(() => undefined)
            }}>Stop Claude</Button>
          ) : null}
          <Button key="mode" plain dimColor onPress={async () => {
            const nextMode = (await read($, mode)) === 'panel' ? 'dialog' : 'panel'
            await update($, mode, () => nextMode)
            await $.store.set('mode', nextMode).catch(() => undefined)
          }}>{m === 'panel' ? 'Questions open here · use dialog' : 'Questions open in the dialog · use panel'}</Button>
        </Box>
      </Box>
    )

    const script = f.path !== '' ? progress('feed', `Script: ${f.title || f.path}`, f.steps, state !== 'working', f.error ? `Following ${f.path} (${f.error})` : undefined) : null
    const planBlock = progress('plan', p.title || 'Progress', p.steps, state !== 'working')

    if (state === 'idle' && !planBlock && !script && list.length === 0) {
      return (
        <Box flexDirection="column">
          {header}
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
          {planBlock}
          {script}
          {activityToggle}
          {expanded ? activity : null}
          {talk}
        </Box>
      )
    }
    if (state === 'finished') {
      return (
        <Box flexDirection="column">
          {header}
          <Box key="finished" flexDirection="column" marginTop={1}>
            <Text bold color={PAL.done}>Task finished · {duration(t.endedAt - t.startedAt)}</Text>
          </Box>
          {summaryCard}
          {whereBlock}
          {planBlock}
          {script}
          {activityToggle}
          {expanded ? activity : null}
          {talk}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {header}
        {planBlock}
        {script}
        {whereBlock}
        {activity}
        {summaryCard}
        {talk}
      </Box>
    )
  })
}
