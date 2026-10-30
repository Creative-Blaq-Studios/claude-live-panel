import { expect, test } from 'claude-code/testing'

import { agentEnd, endedTasks, endTask, noteAction, quietFor, setShellId, shellIdFrom, startTask, visibleTasks } from '../hooks/background'
import type { BgTask } from '../types'

const PANE = {
  plugin: 'live-view',
  component: 'Pane' as const,
  requestId: 'live-view',
  props: { title: 'Live', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
}

const helper = (over: Partial<BgTask> = {}): BgTask => ({ id: 'ag1', kind: 'agent', title: 'Review Task 1', startedAt: 1_000, status: 'running', actions: 0, ...over })

test('a helper action is the proof it still works', async () => {
  const list = noteAction([helper()], 'ag1', 'Reading a file · 0053_smoke.sql', 5_000)
  expect(list[0]?.lastAction).toBe('Reading a file · 0053_smoke.sql')
  expect(list[0]?.lastAt).toBe(5_000)
  expect(list[0]?.actions).toBe(1)
  expect(quietFor(list[0]!, 65_000)).toBe(60_000)
})

test('an action of a loop the panel does not follow changes nothing', async () => {
  const list = [helper()]
  expect(noteAction(list, 'other', 'Reading a file', 5_000)).toBe(list)
})

test('an ended task stops its timer and takes no more actions', async () => {
  const ended = endTask([helper()], 'ag1', 'done', 9_000)
  expect(ended[0]?.status).toBe('done')
  expect(ended[0]?.endedAt).toBe(9_000)
  expect(noteAction(ended, 'ag1', 'Reading a file', 10_000)[0]?.actions).toBe(0)
})

test('a background command ends by the id its notification names', async () => {
  const shell = helper({ id: 'toolu_1', kind: 'shell', title: 'flutter test' })
  const named = setShellId([shell], 'toolu_1', shellIdFrom('Command running in background with ID: b7k2x9. Output is being written to /tmp/x')!)
  expect(named[0]?.shellId).toBe('b7k2x9')
  expect(endTask(named, 'b7k2x9', 'failed', 4_000)[0]?.status).toBe('failed')
})

test('task notifications say which tasks ended and how', async () => {
  const text =
    '<task-notification><task-id>ag1</task-id><status>completed</status></task-notification>' +
    '<task-notification>\n<task-id>b7k2x9</task-id>\n<status>killed</status>\n</task-notification>' +
    '<task-notification><task-id>ag3</task-id><status>failed</status></task-notification>'
  expect(endedTasks(text)).toEqual([
    { id: 'ag1', status: 'done' },
    { id: 'b7k2x9', status: 'stopped' },
    { id: 'ag3', status: 'failed' },
  ])
  expect(endedTasks('plain message')).toEqual([])
})

test("an agent loop's status settles a task the engine never announced", async () => {
  expect(agentEnd('completed')).toBe('done')
  expect(agentEnd('killed')).toBe('stopped')
  expect(agentEnd('running')).toBeUndefined()
  expect(agentEnd('idle')).toBeUndefined()
})

test('ended tasks leave the list after 15 minutes; running ones stay', async () => {
  const old = helper({ id: 'old', status: 'done', endedAt: 0 })
  const running = helper({ id: 'run', startedAt: 0 })
  expect(visibleTasks([old, running], 16 * 60_000).map(t => t.id)).toEqual(['run'])
  expect(startTask([old, running], helper({ id: 'new' }), 16 * 60_000).map(t => t.id)).toEqual(['run', 'new'])
})

test('a background helper shows with its timer and latest action, on every surface', async ($, on) => {
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }) as never)
  await $.agent.spawn({ prompt: 'Review the diff', description: 'Review Task 1', background: true } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Running in the background · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Review Task 1/ })).toBeDefined()
    expect(await ui.find({ text: /Starting/ })).toBeDefined()
    await ui.unmount()
  }
})
