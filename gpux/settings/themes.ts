/**
 * Theme registry for the gpux shell.
 *
 * Pure data: every theme supplies the full palette consumed through `C`
 * in `ui-tokens.ts`. Adding a theme is one object literal here; nothing
 * else needs to change.
 */

export interface Palette {
  bg: string
  rail: string
  pane: string
  raised: string
  border: string
  text: string
  secondary: string
  tertiary: string
  accent: string
  green: string
  blue: string
  amber: string
  red: string
}

export interface Theme {
  id: string
  label: string
  dark: boolean
  colors: Palette
}

export const THEMES: Theme[] = [
  {
    id: 'terax-dark',
    label: 'Terax Dark',
    dark: true,
    colors: {
      bg: '#141417',
      rail: '#1B1B1E',
      pane: '#1E1E22',
      raised: '#26262B',
      border: '#2E2E34',
      text: '#E4E4E7',
      secondary: '#A1A1AA',
      tertiary: '#71717A',
      accent: '#7C6CF0',
      green: '#4ADE80',
      blue: '#60A5FA',
      amber: '#FBBF24',
      red: '#F87171',
    },
  },
  {
    id: 'terax-light',
    label: 'Terax Light',
    dark: false,
    colors: {
      bg: '#F4F4F5',
      rail: '#E9E9EB',
      pane: '#FFFFFF',
      raised: '#EDEDEF',
      border: '#D4D4D8',
      text: '#18181B',
      secondary: '#3F3F46',
      tertiary: '#71717A',
      accent: '#5B4FD6',
      green: '#16A34A',
      blue: '#2563EB',
      amber: '#B45309',
      red: '#DC2626',
    },
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    dark: true,
    colors: {
      bg: '#1F1F28',
      rail: '#1A1A22',
      pane: '#24242F',
      raised: '#2A2A37',
      border: '#363646',
      text: '#DCD7BA',
      secondary: '#A6A69C',
      tertiary: '#727169',
      accent: '#7E9CD8',
      green: '#98BB6C',
      blue: '#7FB4CA',
      amber: '#E6C384',
      red: '#E46876',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: true,
    colors: {
      bg: '#282A36',
      rail: '#21222C',
      pane: '#2B2D3A',
      raised: '#343642',
      border: '#44475A',
      text: '#F8F8F2',
      secondary: '#BFBFC9',
      tertiary: '#6272A4',
      accent: '#BD93F9',
      green: '#50FA7B',
      blue: '#8BE9FD',
      amber: '#F1FA8C',
      red: '#FF5555',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    dark: true,
    colors: {
      bg: '#1A1B26',
      rail: '#16161E',
      pane: '#1F2335',
      raised: '#24283B',
      border: '#2F354D',
      text: '#C0CAF5',
      secondary: '#9AA5CE',
      tertiary: '#565F89',
      accent: '#7AA2F7',
      green: '#9ECE6A',
      blue: '#7DCFFF',
      amber: '#E0AF68',
      red: '#F7768E',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    dark: true,
    colors: {
      bg: '#1E1E2E',
      rail: '#181825',
      pane: '#232332',
      raised: '#2A2A3C',
      border: '#36364A',
      text: '#CDD6F4',
      secondary: '#A6ADC8',
      tertiary: '#6C7086',
      accent: '#CBA6F7',
      green: '#A6E3A1',
      blue: '#89DCEB',
      amber: '#F9E2AF',
      red: '#F38BA8',
    },
  },
]

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id)
}

export function isValidHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

export const PALETTE_KEYS: (keyof Palette)[] = [
  'bg',
  'rail',
  'pane',
  'raised',
  'border',
  'text',
  'secondary',
  'tertiary',
  'accent',
  'green',
  'blue',
  'amber',
  'red',
]
