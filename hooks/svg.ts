import type { Step } from '../types'
import type { Share } from './model'
import { duration } from './model'

const C = { done: '#6B8F71', active: '#D97757', failed: '#C2453D', pending: '#A39E93' }
const STATUS = { done: 'done', active: 'running now', failed: 'failed', pending: 'waiting' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>@media (prefers-reduced-motion:reduce){animate{display:none}}</style>`

/**
 * Bars are drawn this wide and stretch across: the surface fits them to the panel's width.
 */
export const BAR_WIDTH = 800

/**
 * The plan as a rail: one segment per step (sage done, clay now, faint
 * waiting, brick failed). Hovering a segment names the step. Depends only on
 * the steps, so it stays put between real changes.
 */
export function railSvg(steps: Step[], width: number): { source: string; alt: string; height: number } {
  const max = 30
  const activeAt = steps.findIndex(s => s.status === 'active' || s.status === 'failed')
  const done = steps.filter(s => s.status === 'done').length
  let from = 0
  if (steps.length > max) from = Math.min(Math.max(0, (activeAt < 0 ? done : activeAt) - 10), steps.length - max)
  const shown = steps.slice(from, from + max)
  const gap = shown.length > 16 ? 2 : 4
  const segW = Math.max(3, (width - gap * (shown.length - 1)) / Math.max(1, shown.length))
  const height = 22
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${STYLE}`
  shown.forEach((step, i) => {
    const x = (i * (segW + gap)).toFixed(1)
    const isNow = step.status === 'active'
    const y = isNow ? 2 : 5
    const h = isNow ? 18 : 12
    const opacity = step.status === 'pending' ? 0.35 : 1
    const took = step.status === 'done' && step.startedAt !== undefined && step.doneAt !== undefined ? ` · took ${duration(step.doneAt - step.startedAt)}` : ''
    s += `<rect x="${x}" y="${y}" width="${segW.toFixed(1)}" height="${h}" rx="4" fill="${C[step.status]}" opacity="${opacity}">`
    if (isNow) s += `<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite"/>`
    s += `<title>${esc(`${from + i + 1}. ${step.title} (${STATUS[step.status]}${took})`)}</title></rect>`
  })
  s += '</svg>'
  const current = activeAt >= 0 ? steps[activeAt] : undefined

  return { source: s, alt: `${done} of ${steps.length} steps done${current ? `; now on: ${current.title}` : ''}`, height }
}

/** How much of the plan is done, as a ring: sage for the steps done, a pulsing clay arc for the one running now. */
export function ringSvg(steps: Step[], size: number): { source: string; alt: string } {
  const done = steps.filter(s => s.status === 'done').length
  const now = steps.find(s => s.status === 'active' || s.status === 'failed')
  const stroke = Math.max(6, Math.round(size / 10))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = (n: number) => (n / Math.max(1, steps.length)) * c
  const mid = size / 2
  const circle = (color: string, opacity: number, dash?: string, offset = 0) =>
    `<circle cx="${mid}" cy="${mid}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}"` +
    (dash ? ` stroke-dasharray="${dash}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${mid} ${mid})"` : '')
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${STYLE}`
  s += `${circle(C.pending, 0.25)}/>`
  if (done) s += `${circle(C.done, 1, `${arc(done).toFixed(1)} ${c.toFixed(1)}`)}/>`
  if (now) {
    s += `${circle(C[now.status], 1, `${arc(1).toFixed(1)} ${c.toFixed(1)}`, -arc(done))}>`
    s += now.status === 'active' ? `<animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite"/>` : ''
    s += `<title>${esc(now.title)}</title></circle>`
  }
  s += '</svg>'

  return { source: s, alt: `${done} of ${steps.length} steps done${now ? `; now on: ${now.title}` : ''}` }
}

/** The turn's dial: a ring of ticks, a track, and an arc for the share of the estimate used; the time in the middle. */
export function dialSvg(
  dial: { fraction: number; time: string; note: string; color: string; track: string; tick: string; ink: string; muted: string; knob: string },
  size: number,
): { source: string; alt: string } {
  const mid = size / 2
  const outer = mid - 5
  const ticks = 2 * Math.PI * outer
  const r = mid - 22
  const c = 2 * Math.PI * r
  const share = Math.max(0, Math.min(1, dial.fraction))
  const angle = share * 2 * Math.PI - Math.PI / 2
  const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"`
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
  s += `<circle cx="${mid}" cy="${mid}" r="${outer.toFixed(1)}" fill="none" stroke="${dial.tick}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1.5 ${(ticks / 60 - 1.5).toFixed(2)}"/>`
  s += `<circle cx="${mid}" cy="${mid}" r="${r.toFixed(1)}" fill="none" stroke="${dial.track}" stroke-width="11"/>`
  if (share > 0) {
    s += `<circle cx="${mid}" cy="${mid}" r="${r.toFixed(1)}" fill="none" stroke="${dial.color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(share * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${mid} ${mid})"/>`
    s += `<circle cx="${(mid + r * Math.cos(angle)).toFixed(1)}" cy="${(mid + r * Math.sin(angle)).toFixed(1)}" r="6.5" fill="${dial.knob}" stroke="${dial.color}" stroke-width="4"/>`
  }
  s += `<text x="${mid}" y="${(mid + 8).toFixed(1)}" text-anchor="middle" font-size="${Math.round(size * 0.19)}" font-weight="800" fill="${dial.ink}" ${font} style="font-variant-numeric:tabular-nums">${esc(dial.time)}</text>`
  s += `<text x="${mid}" y="${(mid + 32).toFixed(1)}" text-anchor="middle" font-size="12" fill="${dial.muted}" ${font}>${esc(dial.note)}</text>`
  s += '</svg>'

  return { source: s, alt: `${dial.time}, ${dial.note}` }
}

/** A small ring for a background task: its arc sweeps once a minute, like a stopwatch. */
export function miniRingSvg(fraction: number, color: string, track: string, size: number): { source: string; alt: string } {
  const mid = size / 2
  const stroke = 3.5
  const r = mid - stroke
  const c = 2 * Math.PI * r
  const share = Math.max(0.04, Math.min(1, fraction))
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
  s += `<circle cx="${mid}" cy="${mid}" r="${r.toFixed(1)}" fill="none" stroke="${track}" stroke-width="${stroke}"/>`
  s += `<circle cx="${mid}" cy="${mid}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(share * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${mid} ${mid})"/>`
  s += '</svg>'

  return { source: s, alt: '' }
}

/** The plan as thin segments, one per step: done, now, waiting or failed. Hovering one names its step. */
export function segmentsSvg(steps: Step[], colors: { done: string; now: string; waiting: string; failed: string }, width: number): { source: string; alt: string; height: number } {
  const shown = steps.slice(0, 30)
  const gap = shown.length > 16 ? 4 : 8
  const segW = Math.max(3, (width - gap * (shown.length - 1)) / Math.max(1, shown.length))
  const height = 6
  const color = { done: colors.done, active: colors.now, pending: colors.waiting, failed: colors.failed }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`
  shown.forEach((step, i) => {
    s += `<rect x="${(i * (segW + gap)).toFixed(1)}" y="0" width="${segW.toFixed(1)}" height="${height}" rx="3" fill="${color[step.status]}"><title>${esc(`${i + 1}. ${step.title} (${STATUS[step.status]})`)}</title></rect>`
  })
  s += '</svg>'
  const done = steps.filter(st => st.status === 'done').length

  return { source: s, alt: `${done} of ${steps.length} steps done`, height }
}

/** A hairline across the panel, between the folding sections. */
export function hairlineSvg(color: string): { source: string; height: number } {
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH}" height="1" viewBox="0 0 ${BAR_WIDTH} 1" preserveAspectRatio="none"><rect width="${BAR_WIDTH}" height="1" fill="${color}"/></svg>`, height: 1 }
}

/** Where the last 10 minutes went: one bar split by kind of work. Hover a segment for its share. */
export function activitySvg(shares: Share[], width: number): { source: string; alt: string; height: number } {
  const total = shares.reduce((sum, x) => sum + x.ms, 0)
  const height = 16
  const gap = 2
  const usable = width - gap * Math.max(0, shares.length - 1)
  let x = 0
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`
  for (const share of shares) {
    const w = Math.max(4, (share.ms / Math.max(1, total)) * usable)
    s += `<rect x="${x.toFixed(1)}" y="1" width="${w.toFixed(1)}" height="14" rx="4" fill="${share.color}"><title>${esc(`${share.label}: ${duration(share.ms)} (${Math.round((share.ms / total) * 100)}%)`)}</title></rect>`
    x += w + gap
  }
  s += '</svg>'

  return { source: s, alt: `Last 10 minutes: ${shares.map(x => `${x.label} ${Math.round((x.ms / Math.max(1, total)) * 100)}%`).join(', ') || 'nothing yet'}`, height }
}
