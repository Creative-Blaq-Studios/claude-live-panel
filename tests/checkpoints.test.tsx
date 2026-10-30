import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { everyLabel, isAutosaveDue, isTaskFinished, lastManual, parseEvery, pruneSaved, replacedAutos } from '../hooks/checkpoints'
import { sessionLength, sessionLine } from '../hooks/model'
import type { Checkpoint } from '../types'

const PANE = {
  plugin: 'live-view',
  component: 'Pane' as const,
  requestId: 'live-view',
  props: { title: 'Live', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
}
const DAY = 24 * 60 * 60_000
const KEY = 'checkpoints:/work/app'

const cp = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  id: `cp${over.at ?? 1}`,
  at: 1,
  since: 0,
  status: 'ready',
  summary: 'Done.',
  snapshot: { planTitle: 'Progress', steps: [], filesChanged: [], actions: 0, health: 'Finished' },
  ...over,
})

test('the session length reads to the minute, then in hours and days', async () => {
  expect(sessionLength(40_000)).toBe('0m')
  expect(sessionLength(14 * 60_000 + 59_000)).toBe('14m')
  expect(sessionLength((2 * 60 + 31) * 60_000)).toBe('2h 31m')
  expect(sessionLength(DAY + 3 * 3_600_000)).toBe('1d 03h')
})

test('the session line names the start time, and the date when it began on another day', async () => {
  const start = new Date(2026, 9, 31, 9, 14).getTime()
  expect(sessionLine(start, start + (2 * 60 + 31) * 60_000)).toBe('Session · started 09:14 · 2h 31m')
  expect(sessionLine(start - DAY, start)).toBe('Session · started Oct 30, 09:14 · 1d 00h')
})

test('autosave takes 30m, 1h or off, between 10 minutes and 8 hours', async () => {
  expect(parseEvery('30m')).toBe(30 * 60_000)
  expect(parseEvery('1h')).toBe(60 * 60_000)
  expect(parseEvery('90 min')).toBe(90 * 60_000)
  expect(parseEvery('off')).toBe(0)
  expect(parseEvery('5m')).toBeUndefined()
  expect(parseEvery('9h')).toBeUndefined()
  expect(parseEvery('soon')).toBeUndefined()
  expect(everyLabel(30 * 60_000)).toBe('Every 30 min')
  expect(everyLabel(60 * 60_000)).toBe('Every hour')
  expect(everyLabel(120 * 60_000)).toBe('Every 2 hours')
  expect(everyLabel(0)).toBe('Off')
})

test('an automatic checkpoint is due only after the interval, and only after new work', async () => {
  const every = 30 * 60_000
  expect(isAutosaveDue({ every, lastAt: 0, workAt: 1_000, now: every })).toBe(true)
  expect(isAutosaveDue({ every, lastAt: 0, workAt: 1_000, now: every - 1 })).toBe(false)
  expect(isAutosaveDue({ every, lastAt: 5_000, workAt: 1_000, now: 2 * every })).toBe(false)
  expect(isAutosaveDue({ every: 0, lastAt: 0, workAt: 1_000, now: 2 * every })).toBe(false)
})

test('a task counts as finished once, when its last step is done after the last checkpoint', async () => {
  const steps = [
    { title: 'Build', status: 'done' as const, startedAt: 1, doneAt: 10 },
    { title: 'Test', status: 'done' as const, startedAt: 10, doneAt: 20 },
  ]
  expect(isTaskFinished(steps, 15)).toBe(true)
  expect(isTaskFinished(steps, 20)).toBe(false)
  expect(isTaskFinished([...steps, { title: 'Ship', status: 'pending' }], 0)).toBe(false)
  expect(isTaskFinished([], 0)).toBe(false)
})

test('a new checkpoint replaces the automatic ones since the last manual one', async () => {
  const list = [cp({ id: 'a0', at: 1, isAuto: true }), cp({ id: 'm1', at: 2 }), cp({ id: 'a1', at: 3, isAuto: true }), cp({ id: 'a2', at: 4, isAuto: true })]
  expect(lastManual(list)?.id).toBe('m1')
  expect(replacedAutos(list, lastManual(list))).toEqual(['a1', 'a2'])
  expect(replacedAutos([cp({ id: 'a1', isAuto: true })], undefined)).toEqual(['a1'])
})

test('saved checkpoints older than 30 days go, unless a decision in them is open', async () => {
  const now = 100 * DAY
  const open = { question: 'Subagents or here?', options: [{ label: 'Here' }], multiSelect: false }
  const list = [cp({ id: 'old', at: now - 31 * DAY }), cp({ id: 'decide', at: now - 60 * DAY, pending: [open] }), cp({ id: 'new', at: now - DAY })]
  expect(pruneSaved(list, now).map(c => c.id)).toEqual(['decide', 'new'])
})

test('over 10 saved checkpoints, the oldest without an open decision go first', async () => {
  const open = { question: 'Subagents or here?', options: [], multiSelect: false }
  const list = [cp({ id: 'decide', at: 1, pending: [open] }), ...Array.from({ length: 11 }, (_, i) => cp({ id: `c${i}`, at: 2 + i }))]
  const kept = pruneSaved(list, 20)
  expect(kept.length).toBe(10)
  expect(kept[0]?.id).toBe('decide')
  expect(kept.map(c => c.id)).not.toContain('c0')
  expect(kept.map(c => c.id)).not.toContain('c1')
})

/** The engine beneath the panel: a project folder, a store in memory the test reads back, and a recap for each checkpoint. */
const engine = (on: Parameters<TestBody>[1], stored: Record<string, unknown> = {}, folders: string[] = ['/work/app']) => {
  const store = new Map(Object.entries(stored))
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }) as never)
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  const clock = mock.clock(on, { now: Date.now() })
  let recaps = 0
  on('command.register', () => ({ value: { command: 'live' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work/app' }) as never)
  on('session.usage', () => ({ value: { startedAt: Date.now() - (2 * 60 + 31) * 60_000 - 5_000, context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('fs.stat', (_, e) =>
    folders.includes(e.path)
      ? ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never)
      : ({ deny: `ENOENT: no such file or directory, stat '${e.path}'` } as never),
  )
  on('http.fetch', () => ({ value: { ok: false, status: 404, text: '' } }) as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: `Recap ${++recaps}.`, usage: {} } }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { store, clock }
}

const finishTask = async ($: Parameters<TestBody>[0], turnId: string, step: string) => {
  await $.turn.start({ text: 'Go', turnId })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: step, status: 'completed' }] } as never)
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
}

/** This project's saved checkpoints, once the one being written is done. */
const saved = async ({ store, clock }: ReturnType<typeof engine>) => {
  await clock.settle()
  return (store.get(KEY) as Checkpoint[] | undefined) ?? []
}

/** Lets the wall clock move on by a millisecond, so the next step finishes after the last checkpoint. */
const tickOn = () => {
  const from = Date.now()
  while (Date.now() === from) {}
}

test('the Session tile shows how long the session has run and when it started, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /^2h 31m$/ })).toBeDefined()
    expect(await ui.find({ text: /^since (\w{3} \d{1,2}, )?\d\d:\d\d$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished task saves an automatic checkpoint, and the next one replaces it', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  await finishTask($, 't1', 'Build the timer')
  const first = await saved(world)
  expect(first.map(c => [c.isAuto, c.summary])).toEqual([[true, 'Recap 1.']])

  tickOn()
  await finishTask($, 't2', 'Build the autosave')
  const second = await saved(world)
  expect(second.map(c => [c.isAuto, c.summary])).toEqual([[true, 'Recap 2.']])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /Auto/ })).toBeDefined()
  await ui.unmount()
})

test('autosave off: a finished task saves nothing', async ($, on) => {
  const world = engine(on, { autosave: 0 })
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  await finishTask($, 't1', 'Build the timer')
  expect(await saved(world)).toEqual([])
})

test('/live autosave sets the interval and keeps it for later sessions', async ($, on) => {
  const { store } = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  const set = await $.command.run({ command: 'live', args: 'autosave 1h' } as never)
  expect((set as { text: string }).text).toMatch(/every hour/i)
  expect(store.get('autosave')).toBe(60 * 60_000)
  const bad = await $.command.run({ command: 'live', args: 'autosave 2m' } as never)
  expect((bad as { text: string }).text).toMatch(/10 minutes/)
  expect(store.get('autosave')).toBe(60 * 60_000)
})

test('at the start, old checkpoints and the lists of deleted project folders are cleaned up', async ($, on) => {
  const now = Date.now()
  const open = { question: 'Subagents or here?', options: [], multiSelect: false }
  const { store } = engine(on, {
    [KEY]: [cp({ id: 'old', at: now - 40 * DAY }), cp({ id: 'decide', at: now - 40 * DAY, pending: [open] }), cp({ id: 'new', at: now - DAY })],
    'checkpoints:/work/gone': [cp({ id: 'gone', at: now - DAY })],
  })
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  expect((store.get(KEY) as Checkpoint[]).map(c => c.id)).toEqual(['decide', 'new'])
  expect(store.get('checkpoints:/work/gone')).toBeUndefined()
})

test('/live checkpoints tells what is saved, and clear deletes this project\'s saved checkpoints', async ($, on) => {
  const { store } = engine(on, { [KEY]: [cp({ id: 'one', at: Date.now() })] })
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  const info = await $.command.run({ command: 'live', args: 'checkpoints' } as never)
  expect((info as { text: string }).text).toMatch(/1 saved checkpoint/)
  const cleared = await $.command.run({ command: 'live', args: 'checkpoints clear' } as never)
  expect((cleared as { text: string }).text).toMatch(/Deleted the 1 saved checkpoint/)
  expect(store.get(KEY)).toBeUndefined()
})

test('the Auto-save menu sets the interval, where the surface has menus', async ($, on) => {
  const { store } = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await finishTask($, 't1', 'Build the timer')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'autosave' } as never)).toBeUndefined()
  await ui.press({ key: 'sec-checkpoints-toggle' })
  await ui.select({ key: 'autosave', value: '60' })
  expect(store.get('autosave')).toBe(60 * 60_000)
  await ui.unmount()

  const text = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await text.find({ text: /Auto-save: every hour/ })).toBeDefined()
  await text.unmount()
})

test('a checkpoint you save replaces the automatic one, and recaps count from yours alone', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await finishTask($, 't1', 'Build the timer')
  expect((await saved(world)).map(c => c.isAuto)).toEqual([true])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /since the checkpoint/ })).toBeUndefined()
  await ui.unmount()

  await $.command.run({ command: 'live', args: 'checkpoint' } as never)
  expect((await saved(world)).map(c => [c.isAuto ?? false, c.summary])).toEqual([[false, 'Recap 2.']])
})

test('while Claude works, the dial shows the turn time with Pause, Stop and Save, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Build the dial', status: 'in_progress' }, { content: 'Ship it', status: 'pending' }] } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /^This turn$/ })).toBeDefined()
    expect(await ui.find({ text: /^Step 1 of 2$/ })).toBeDefined()
    expect(await ui.find({ key: 'dial-stop' } as never)).toBeDefined()
    expect(await ui.find({ key: 'dial-pause' } as never)).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ text: /^0:0\d$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the Light and Dark toggle sets the look for later sessions; the terminal keeps its own theme', async ($, on) => {
  const { store } = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'theme-light' })
  expect(store.get('theme')).toBe('light')
  await ui.press({ key: 'theme-dark' })
  expect(store.get('theme')).toBe('dark')
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ key: 'theme-dark' } as never)).toBeUndefined()
  await term.unmount()
})

test('Steps is open from the start; a press folds a section or opens it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Build the dial', status: 'completed' }, { content: 'Ship it', status: 'in_progress' }] } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ text: /1 of 2 · 50%/ })).toBeDefined()
  expect(await ui.find({ text: /Build the dial/ })).toBeDefined()
  await ui.press({ key: 'sec-steps-toggle' })
  expect(await ui.find({ text: /Build the dial/ })).toBeUndefined()
  await ui.press({ key: 'sec-activity-toggle' })
  expect(await ui.find({ text: /Show all recent actions|Nothing yet|Planning|Updating the plan/ })).toBeDefined()
  await ui.unmount()
})

test('no button, menu or text field sits on a painted card, in either look', async ($, on) => {
  engine(on)
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }) as never)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Build the dial', status: 'in_progress' }] } as never)
  await $.agent.spawn({ prompt: 'Review', description: 'Review the dial', background: true } as never)

  type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }
  const controlsOnPaint = (node: Node | string, painted = false): string[] => {
    if (typeof node === 'string') return []
    const isPainted = painted || node.props?.backgroundColor !== undefined
    const own = isPainted && ['Button', 'Select', 'Input'].includes(node.type) ? [`${node.type} ${String(node.props?.key ?? '')}`] : []
    return [...own, ...(node.children ?? []).flatMap(child => controlsOnPaint(child, isPainted))]
  }
  const paintedCards = (node: Node | string): number =>
    typeof node === 'string' ? 0 : (node.props?.backgroundColor !== undefined ? 1 : 0) + (node.children ?? []).reduce((n, child) => n + paintedCards(child), 0)
  for (const look of ['theme-light', 'theme-dark'] as const) {
    for (const surface of ['desktop', 'vscode'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: look })
      const tree = (await ui.drawn()) as unknown as Node
      expect(paintedCards(tree)).toBeGreaterThan(0)
      expect(controlsOnPaint(tree)).toEqual([])
      await ui.unmount()
    }
  }
  await $.turn.complete({ answer: 'Shall I ship it?', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(controlsOnPaint((await ui.drawn()) as unknown as Node)).toEqual([])
  await ui.unmount()
})
