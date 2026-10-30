import type { BgStatus, BgTask } from '../types'

/** A running task with no new action for this long reads as quiet. */
export const QUIET_AFTER = 5 * 60_000
/** Finished tasks stay in the list this long. */
const KEEP_ENDED = 15 * 60_000
const MAX_TASKS = 20

export const isRecent = (t: BgTask, now: number) => t.status === 'running' || now - (t.endedAt ?? now) < KEEP_ENDED

export const visibleTasks = (list: BgTask[], now: number) => list.filter(t => isRecent(t, now))

export const startTask = (list: BgTask[], task: BgTask, now: number): BgTask[] =>
  [...list.filter(t => t.id !== task.id && isRecent(t, now)), task].slice(-MAX_TASKS)

export const noteAction = (list: BgTask[], id: string, action: string, now: number): BgTask[] =>
  list.some(t => t.id === id && t.status === 'running')
    ? list.map(t => (t.id === id && t.status === 'running' ? { ...t, lastAction: action, lastAt: now, actions: t.actions + 1 } : t))
    : list

/** Ends the running task with this id, or with this background command id. */
export const endTask = (list: BgTask[], id: string, status: BgStatus, now: number): BgTask[] =>
  list.some(t => (t.id === id || t.shellId === id) && t.status === 'running')
    ? list.map(t => ((t.id === id || t.shellId === id) && t.status === 'running' ? { ...t, status, endedAt: now } : t))
    : list

export const setShellId = (list: BgTask[], id: string, shellId: string): BgTask[] => list.map(t => (t.id === id ? { ...t, shellId } : t))

/** The id a background Bash call answers with: "Command running in background with ID: b1x2". */
export const shellIdFrom = (text: string) => text.match(/in background with ID:\s*([A-Za-z0-9_-]+)/)?.[1]

const endStatus = (word: string): BgStatus => (word === 'failed' ? 'failed' : word === 'killed' || word === 'stopped' ? 'stopped' : 'done')

/** Every task a message's <task-notification> blocks report as ended. */
export const endedTasks = (text: string): { id: string; status: BgStatus }[] =>
  [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const body = m[1] ?? ''
    const id = body.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
    const word = body.match(/<status>([^<]+)<\/status>/)?.[1]?.trim().toLowerCase() ?? ''
    return id ? [{ id, status: endStatus(word) }] : []
  })

/** The engine's word for an agent loop that has stopped, or undefined while it still works. */
export const agentEnd = (status: string): BgStatus | undefined =>
  status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'killed' ? 'stopped' : undefined

export const quietFor = (t: BgTask, now: number) => now - (t.lastAt ?? t.startedAt)
