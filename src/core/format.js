import { getLocale } from './i18n.js';

const DAY = 86_400_000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const japanese = () => getLocale() === 'ja';

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const pad3 = (n) => (n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n);

const priceFormatters = new Map();

/** Price with thousands separators. */
export function formatPrice(v, precision = 2) {
  if (v !== v) return '—';
  let f = priceFormatters.get(precision);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    priceFormatters.set(precision, f);
  }
  return f.format(v);
}

/** Compact notation such as 1.2K / 3.4M / 5.6B (for volume etc.). */
export function formatCompact(v) {
  if (v !== v) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0);
  return v.toFixed(2);
}

export function formatPercent(v, digits = 2) {
  if (v !== v) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits) + '%';
}

export function formatSigned(v, precision = 2) {
  if (v !== v) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + formatPrice(Math.abs(v), precision);
}

/** Wall-clock parts after adding utcOffset (ms). */
export function dateParts(t, offset = 0) {
  const d = new Date(t + offset);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    wd: d.getUTCDay(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * Date-time text for the crosshair. The level of detail follows the bar interval.
 * @param {number} t      UNIX milliseconds
 * @param {number} offset time zone offset (ms)
 * @param {number} interval bar interval (ms)
 */
export function formatDateTime(t, offset, interval) {
  if (t !== t) return '';
  const p = dateParts(t, offset);
  const date = japanese()
    ? `${p.y}/${pad2(p.mo)}/${pad2(p.d)} (${WEEKDAYS[p.wd]})`
    : `${WEEKDAYS_EN[p.wd]} ${p.d} ${MONTHS_EN[p.mo - 1]} ${p.y}`;
  if (interval >= DAY) return date;
  const hm = `${pad2(p.h)}:${pad2(p.mi)}`;
  if (interval >= 60_000) return `${date} ${hm}`;
  if (interval >= 1000) return `${date} ${hm}:${pad2(p.s)}`;
  return `${date} ${hm}:${pad2(p.s)}.${pad3(p.ms)}`;
}

/** Tick label for the time axis. `level` is a TimeMarks weight. */
export function formatMark(t, offset, level) {
  const p = dateParts(t, offset);
  const ja = japanese();
  if (level >= 70) return ja ? `${p.y}年` : `${p.y}`;
  if (level >= 60) return ja ? `${p.mo}月` : MONTHS_EN[p.mo - 1];
  if (level >= 50) return ja ? `${p.mo}/${p.d}` : `${p.d} ${MONTHS_EN[p.mo - 1]}`;
  if (level >= 30) return `${pad2(p.h)}:${pad2(p.mi)}`;
  if (level >= 20) return `${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`;
  return `:${pad2(p.s)}.${pad3(p.ms)}`;
}

/** Human-readable duration. */
export function formatDuration(ms) {
  const a = Math.abs(ms);
  const u = japanese() ? { s: '秒', m: '分', h: '時間', d: '日', sep: '' } : { s: 's', m: 'm', h: 'h', d: 'd', sep: ' ' };
  if (a < 1000) return `${Math.round(a)}ms`;
  if (a < 60_000) return `${(a / 1000).toFixed(a < 10_000 ? 1 : 0)}${u.s}`;
  if (a < 3_600_000) return `${Math.round(a / 60_000)}${u.m}`;
  if (a < DAY) {
    const h = Math.floor(a / 3_600_000);
    const m = Math.round((a % 3_600_000) / 60_000);
    return m ? `${h}${u.h}${u.sep}${m}${u.m}` : `${h}${u.h}`;
  }
  const d = Math.floor(a / DAY);
  const h = Math.round((a % DAY) / 3_600_000);
  return h && d < 10 ? `${d}${u.d}${u.sep}${h}${u.h}` : `${d}${u.d}`;
}
