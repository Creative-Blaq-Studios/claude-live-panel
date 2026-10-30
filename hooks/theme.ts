/** The panel's colors: what the page and cards are painted, and the inks and marks on them. */
export type Palette = {
  /** The page and the cards; absent where the panel paints no background (the terminal). */
  bg?: string
  surface?: string
  line: string
  ink: string
  ink2: string
  muted: string
  track: string
  tick: string
  /** Clay: what runs now. */
  accent: string
  done: string
  quiet: string
  failed: string
}

export type ThemeName = 'light' | 'dark'

/** Warm white, with clay for what runs now. */
export const LIGHT: Palette = {
  bg: '#FFFFFF',
  surface: '#F8F6F3',
  line: '#E2DDD6',
  ink: '#1E1C1A',
  ink2: '#3B3733',
  muted: '#5F5A54',
  track: '#ECE7E0',
  tick: '#D6CFC6',
  accent: '#B85A36',
  done: '#2E8B62',
  quiet: '#9A6413',
  failed: '#C2453D',
}

/** Warm near-black, with a brighter clay so it reads on the dark ground. */
export const DARK: Palette = {
  bg: '#1C1A18',
  surface: '#262320',
  line: '#3A3531',
  ink: '#F3EFE9',
  ink2: '#D9D3CB',
  muted: '#A9A198',
  track: '#332E2A',
  tick: '#4D4640',
  accent: '#E08A63',
  done: '#5DBB8A',
  quiet: '#E0A84A',
  failed: '#E5736B',
}

/** The terminal keeps the person's own theme: its theme keys, and no painted backgrounds. */
export const TERMINAL: Palette = {
  line: 'subtle',
  ink: 'text',
  ink2: 'text',
  muted: 'inactive',
  track: 'subtle',
  tick: 'subtle',
  accent: 'claude',
  done: 'success',
  quiet: 'warning',
  failed: 'error',
}

/** The look that matches the person's Claude Code theme setting: light for the light themes, dark for the rest. */
export const themeFrom = (setting: unknown): ThemeName => (typeof setting === 'string' && setting.toLowerCase().startsWith('light') ? 'light' : 'dark')
