import { BarData } from '../core/BarData.js';
import { t } from '../core/i18n.js';

const NAMES = {
  time: ['time', 'date', 'datetime', 'timestamp', '日付', '日時', '時刻'],
  open: ['open', 'o', '始値'],
  high: ['high', 'h', '高値'],
  low: ['low', 'l', '安値'],
  close: ['close', 'c', 'adj close', '終値'],
  volume: ['volume', 'vol', 'v', '出来高'],
};

/**
 * Convert the time column to UNIX milliseconds. Dates and date-times without a time zone are read as local time
 * (reading a date-only row as UTC midnight would shift it to the previous day west of UTC).
 */
function parseTime(s) {
  s = s.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s); // 20260105
  if (m && +m[1] >= 1900 && +m[1] <= 2200 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }
  m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), +(m[7] ?? '0').padEnd(3, '0')).getTime();
  const num = Number(s);
  if (s !== '' && Number.isFinite(num)) return num < 1e11 ? num * 1000 : num; // seconds or milliseconds
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** Read a numeric cell, including thousands separators such as "1,234.5". */
function parseNumber(s) {
  if (s === undefined) return NaN;
  s = s.trim();
  if (s === '') return NaN;
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  return Number(s);
}

/** Split a row into cells, honoring quoted cells (which may contain the separator or ""). */
function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Decode file contents to text. If it is not valid UTF-8, assume Shift_JIS (common in CSV exports from Japanese brokers). */
export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

/**
 * Turn CSV text into BarData. Columns are found from the header row (time / open / high / low / close / volume; Japanese headers also work).
 * A CSV with only `close` loads as line data. Rows are sorted by time, ascending.
 * @returns {{ data: BarData, precision: number }}
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error(t('The CSV has no rows'));
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const split = (l) => splitLine(l, sep);
  const header = split(lines[0].replace(/^\ufeff/, '')).map((h) => h.toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(NAMES)) col[key] = header.findIndex((h) => names.includes(h));
  if (col.time < 0 || col.close < 0) throw new Error(t('Columns "time" and "close" are required'));

  const rows = [];
  let decimals = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const time = parseTime(c[col.time] ?? '');
    const close = parseNumber(c[col.close]);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    const num = (k) => {
      const v = col[k] >= 0 ? parseNumber(c[col[k]]) : NaN;
      return Number.isFinite(v) ? v : close;
    };
    const open = num('open');
    const volume = col.volume >= 0 ? parseNumber(c[col.volume]) : 0;
    rows.push({ time, open, high: Math.max(num('high'), open, close), low: Math.min(num('low'), open, close), close, volume: Number.isFinite(volume) ? volume : 0 });
    if (i < 300) decimals = Math.max(decimals, (c[col.close].split('.')[1] ?? '').length);
  }
  if (!rows.length) throw new Error(t('No readable rows were found'));
  rows.sort((a, b) => a.time - b.time);
  return { data: BarData.from(rows), precision: Math.min(8, decimals) };
}
