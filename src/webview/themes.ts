export interface PanelTheme {
  id: string;
  label: string;
  accent: string;
  /** Text and icons drawn on top of the accent colour. */
  ink: string;
  /** Darker accent used for the canvas's own primary colour. */
  strong: string;
  light: string;
  dark: string;
  iconFilter: string;
}

export const THEMES: PanelTheme[] = [
  { id: 'blue', label: 'Blue', accent: '#005fff', ink: '#ffffff', strong: '#0048c2', light: '#d6e4ff', dark: '#0f2a5c', iconFilter: 'brightness(0) invert(1)' },
  { id: 'yellow', label: 'Yellow', accent: '#ffd900', ink: '#2e2936', strong: '#c99a00', light: '#fff4b8', dark: '#4a4017', iconFilter: 'brightness(0)' },
  { id: 'mint', label: 'Mint', accent: '#87dac7', ink: '#12332d', strong: '#3fa893', light: '#d9f4ec', dark: '#1e4a41', iconFilter: 'brightness(0)' },
  { id: 'coral', label: 'Coral', accent: '#ec5451', ink: '#ffffff', strong: '#c23b38', light: '#ffdad9', dark: '#5a1f1e', iconFilter: 'brightness(0) invert(1)' },
  { id: 'violet', label: 'Violet', accent: '#8b5cf6', ink: '#ffffff', strong: '#6d3fd6', light: '#e7ddff', dark: '#2f2457', iconFilter: 'brightness(0) invert(1)' },
];

const KEY = 'drawper.theme';

export const themeById = (id: string | null | undefined): PanelTheme => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function loadTheme(): PanelTheme {
  try { return themeById(localStorage.getItem(KEY)); } catch { return THEMES[0]; }
}

export function saveTheme(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
}

export const themeVars = (t: PanelTheme) => ({
  '--dp-accent': t.accent,
  '--dp-ink': t.ink,
  '--dp-strong': t.strong,
  '--dp-light': t.light,
  '--dp-dark': t.dark,
  '--dp-ico': t.iconFilter,
}) as Record<string, string>;
