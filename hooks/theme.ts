/**
 * The panel's colors. The app paints the ground and draws every button, menu and text field in its
 * own theme, so the panel paints only its cards, and those hold no controls: on any app theme,
 * the controls sit on the app's ground and read as the app draws them.
 */
export type Palette = {
  /** A card's fill; absent where nothing is painted (the app's ground, and the terminal). */
  surface?: string
  line: string
  /** Absent: the app's own text color. */
  ink?: string
  ink2?: string
  /** Absent: the app's own dim text (with `dim`). */
  muted?: string
  dim?: boolean
  track: string
  tick: string
  /** Clay: what runs now. */
  accent: string
  done: string
  quiet: string
  failed: string
}

export type ThemeName = 'light' | 'dark'

/** Light cards: warm white, with clay for what runs now. */
export const LIGHT: Palette = {
  surface: '#FBFAF8',
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

/** Dark cards: warm near-black, with a brighter clay so it reads on the dark ground. */
export const DARK: Palette = {
  surface: '#2A2724',
  line: '#3A3531',
  ink: '#F3EFE9',
  ink2: '#D9D3CB',
  muted: '#AEA69D',
  track: '#3A3530',
  tick: '#524B44',
  accent: '#E08A63',
  done: '#5DBB8A',
  quiet: '#E0A84A',
  failed: '#E5736B',
}

/** On the app's own ground: its text colors, and marks that read on light and dark alike. */
export const APP: Palette = {
  line: '#A39E93',
  dim: true,
  track: '#A39E9355',
  tick: '#A39E93',
  accent: '#D97757',
  done: '#6B8F71',
  quiet: '#C9A24A',
  failed: '#C2453D',
}

/** The look that matches the person's Claude Code theme setting: light for the light themes, dark for the rest. */
export const themeFrom = (setting: unknown): ThemeName => (typeof setting === 'string' && setting.toLowerCase().startsWith('light') ? 'light' : 'dark')
