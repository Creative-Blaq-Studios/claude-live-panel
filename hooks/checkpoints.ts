import type { Checkpoint, Step } from '../types'

/** How often the panel saves a checkpoint on its own, unless the person picks another time. */
export const DEFAULT_AUTOSAVE = 30 * 60_000
/** The times the Checkpoints menu offers, in minutes; 0 is off. */
export const AUTOSAVE_CHOICES = [15, 30, 60, 120, 0]
/** Saved checkpoints older than this go, unless a decision in them is still open. */
export const KEEP_SAVED = 30 * 24 * 60 * 60_000
/** Saved checkpoints kept for each project. */
export const MAX_SAVED = 10
/** The store key prefix of each project's saved checkpoints, followed by the project folder. */
export const CHECKPOINTS = 'checkpoints:'

/** "30m", "1h", "90 min" or "off" as milliseconds, 0 for off; undefined when it is not one, or not between 10 minutes and 8 hours. */
export function parseEvery(text: string): number | undefined {
  const t = text.trim().toLowerCase()
  if (t === 'off') return 0
  const m = t.match(/^(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?)$/)
  if (!m) return undefined
  const ms = Number(m[1]) * (m[2]!.startsWith('h') ? 3_600_000 : 60_000)
  return ms >= 10 * 60_000 && ms <= 8 * 3_600_000 ? ms : undefined
}

/** "Every 30 min", "Every hour", "Every 2 hours" or "Off". */
export function everyLabel(ms: number): string {
  if (ms <= 0) return 'Off'
  const min = Math.round(ms / 60_000)
  if (min % 60 !== 0) return `Every ${min} min`
  const h = min / 60
  return h === 1 ? 'Every hour' : `Every ${h} hours`
}

/** The timer's call: the time has passed since the last checkpoint, and Claude did something after it. */
export const isAutosaveDue = (input: { every: number; lastAt: number; workAt: number; now: number }) =>
  input.every > 0 && input.workAt > input.lastAt && input.now - input.lastAt >= input.every

/** Every step of the task list is done, and the last of them after `since`: a finish no checkpoint has seen yet. */
export const isTaskFinished = (steps: Step[], since: number) =>
  steps.length > 0 && steps.every(s => s.status === 'done') && steps.some(s => (s.doneAt ?? 0) > since)

/**
 * The last checkpoint the person saved, with its recap: where a section, a recap and a new checkpoint
 * count from. Automatic checkpoints keep the place for later sessions and start no section.
 */
export const lastManual = (list: Checkpoint[]) => [...list].reverse().find(c => c.status === 'ready' && !c.isAuto)

/** The automatic checkpoints a new checkpoint replaces: those after the last manual one, whose work it covers again. */
export const replacedAutos = (list: Checkpoint[], base: Checkpoint | undefined) => list.filter(c => c.isAuto && c.at > (base?.at ?? 0)).map(c => c.id)

/**
 * What a project keeps on disk: nothing older than 30 days, and the newest 10. A checkpoint with an
 * open decision stays until the person acts on it; over the limit, the oldest of the others go first.
 */
export function pruneSaved(list: Checkpoint[], now: number): Checkpoint[] {
  const fresh = list.filter(c => c.pending?.length || now - c.at < KEEP_SAVED)
  const extra = fresh.length - MAX_SAVED
  if (extra <= 0) return fresh
  const drop = new Set(fresh.filter(c => !c.pending?.length).slice(0, extra).map(c => c.id))
  return fresh.filter(c => !drop.has(c.id))
}

/** The checkpoint with its decision made: the person continued from it, so it is no longer kept for that. */
export const settleDecision = (list: Checkpoint[], id: string) =>
  list.map(c => (c.id === id && c.pending ? (({ pending: _, ...rest }) => rest)(c) : c))
