/**
 * Themes. Both canvas drawing and the UI (CSS variables) read from here.
 * setTheme() accepts a theme name or an object that overrides an existing theme.
 *
 * The look is "paper and ink": rules and borders are thin and faint so the data itself leads.
 * Saturation and contrast are kept moderate so the chart stays comfortable to look at for long
 * (text is a dark ink tone rather than pure black; up / down are a calm vermilion and indigo).
 * Selected states are shown by inverting light and dark, not by color.
 */
// Body text uses the OS sans-serif (Hiragino on macOS, Yu Gothic UI / Meiryo on Windows).
const sans = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans JP", "Segoe UI", system-ui, sans-serif';
// Digits are monospaced so columns line up. Japanese fonts come before the generic `monospace` so mixed text matches the body face.
const mono = '"SF Mono", ui-monospace, Menlo, Consolas, "Cascadia Mono", "Roboto Mono", "Hiragino Sans", "Yu Gothic UI", Meiryo, "Noto Sans JP", monospace';

export const themes = {
  // Paper: ink on unbleached paper
  light: {
    name: 'light',
    label: 'Paper',
    font: sans,
    mono,
    bg: '#f5f2eb',
    surface: '#ece8de',
    surfaceHover: '#e3ded2',
    border: '#d9d3c6',
    text: '#3a3732',
    textMuted: '#77726a',
    textFaint: '#aaa598',
    grid: 'rgba(58,55,50,0.075)',
    gridMinor: 'rgba(58,55,50,0.035)',
    axisLine: '#d3ccbe',
    crosshair: 'rgba(58,55,50,0.42)',
    tagBg: '#4a4640',
    tagText: '#f5f2eb',
    up: '#b9604d',
    down: '#4f7399',
    accent: '#b9604d',
    series: '#3a3732',
    annotation: '#55514a',
    heat: '#a57f2a',
    selection: 'rgba(58,55,50,0.08)',
    // Categorical colors for indicators. The order was validated so that neighbouring colors stay
    // distinguishable under color-vision deficiencies and keep 3:1 contrast with the background (same for Ink).
    palette: ['#3b74b4', '#ce6332', '#1a906c', '#ad8210', '#c45c8a', '#7062c2', '#1c8ea6', '#c4504a'],
  },
  // Ink: paper-colored text on a warm black
  dark: {
    name: 'dark',
    label: 'Ink',
    font: sans,
    mono,
    bg: '#1c1b19',
    surface: '#252421',
    surfaceHover: '#2e2d29',
    border: '#383631',
    text: '#d8d3c7',
    textMuted: '#958f84',
    textFaint: '#69645c',
    grid: 'rgba(216,211,199,0.07)',
    gridMinor: 'rgba(216,211,199,0.035)',
    axisLine: '#3b3934',
    crosshair: 'rgba(216,211,199,0.4)',
    tagBg: '#cfcabe',
    tagText: '#1c1b19',
    up: '#cf7460',
    down: '#7099be',
    accent: '#cf7460',
    series: '#d8d3c7',
    annotation: '#bdb7ab',
    heat: '#c9a252',
    selection: 'rgba(216,211,199,0.1)',
    palette: ['#5b90d4', '#d0733c', '#34a07c', '#b98c18', '#cf668f', '#8b7ddf', '#1fa3a8', '#d4625c'],
  },
};

/** Candle color schemes */
export const candleSchemes = {
  wa: { label: 'Vermilion & indigo (up = red / down = blue)', light: ['#b9604d', '#4f7399'], dark: ['#cf7460', '#7099be'] },
  intl: { label: 'Green & red (up = green / down = red)', light: ['#4d8a6a', '#b9604d'], dark: ['#72ab8a', '#cf7460'] },
  sumi: { label: 'Ink tones (up = light / down = dark)', light: ['#aaa598', '#3a3732'], dark: ['#d8d3c7', '#7a756c'] },
};

/**
 * @param {string|object} theme a theme name, or an object that overrides an existing theme (`name` picks the base)
 * @param {string|{up:string, down:string}} [scheme] a candle scheme id, or your own up / down colors
 */
export function resolveTheme(theme, scheme = 'wa') {
  const base = typeof theme === 'string' ? themes[theme] ?? themes.light : { ...(themes[theme?.name] ?? themes.light), ...theme };
  if (scheme && typeof scheme === 'object' && scheme.up && scheme.down) return { ...base, up: scheme.up, down: scheme.down, scheme };
  const id = candleSchemes[scheme] ? scheme : 'wa';
  const [up, down] = candleSchemes[id][base.name] ?? candleSchemes[id].light;
  return { ...base, up, down, scheme: id };
}

/**
 * Resolve a color spec to a CSS color.
 *   number → the theme's categorical color (palette[n])
 *   'up' / 'down' / 'accent' / 'muted' / 'text' / 'series' / 'heat' → the theme's role color
 *   anything else → used as is
 */
export function resolveColor(theme, c) {
  if (typeof c === 'number') return theme.palette[c % theme.palette.length];
  switch (c) {
    case 'up': return theme.up;
    case 'down': return theme.down;
    case 'accent': return theme.accent;
    case 'muted': return theme.textMuted;
    case 'text': return theme.text;
    case 'series': return theme.series;
    case 'heat': return theme.heat;
    default: return c;
  }
}

/** Add alpha to #rrggbb. */
export function withAlpha(color, a) {
  if (typeof color === 'string' && color[0] === '#' && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

/** Readable text color for a background (ink or paper). */
export function contrastText(color) {
  if (typeof color === 'string' && color[0] === '#' && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.58 ? '#2b2925' : '#faf8f3';
  }
  return '#faf8f3';
}
