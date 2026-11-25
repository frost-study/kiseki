/**
 * Numeric building blocks for indicators.
 *
 * All are resumable: fn(src, len, out, from, n) writes only out[from..n-1] and
 * trusts everything before it as the previous result. On a live update from = n-1,
 * so a tick costs constant time no matter how many millions of bars there are.
 * Where there is not enough data yet (warm-up), the value is NaN.
 */

/** Simple moving average. */
export function sma(src, len, out, from, n) {
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    const prev = i > 0 ? out[i - 1] : NaN;
    const cur = src[i];
    const drop = i >= len ? src[i - len] : NaN;
    if (prev === prev && drop === drop && cur === cur) {
      out[i] = prev + (cur - drop) / len;
    } else {
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += src[j];
      out[i] = s / len;
    }
  }
}

/** Exponential moving average, seeded with the simple average of the first `len` values. */
export function ema(src, len, out, from, n, alpha = 2 / (len + 1)) {
  for (let i = from; i < n; i++) {
    const prev = i > 0 ? out[i - 1] : NaN;
    const cur = src[i];
    if (prev === prev) {
      out[i] = cur === cur ? prev + alpha * (cur - prev) : prev;
    } else if (i >= len - 1 && cur === cur && src[i - len + 1] === src[i - len + 1]) {
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += src[j];
      out[i] = s / len;
    } else {
      out[i] = NaN;
    }
  }
}

/** Wilder's smoothed moving average (used by RSI and ATR). */
export function rma(src, len, out, from, n) {
  ema(src, len, out, from, n, 1 / len);
}

/** Weighted moving average (newer values weigh more). */
export function wma(src, len, out, from, n) {
  const denom = (len * (len + 1)) / 2;
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    let s = 0;
    for (let j = 0; j < len; j++) s += src[i - j] * (len - j);
    out[i] = s / denom;
  }
}

/** Population standard deviation. */
export function stdev(src, len, out, from, n) {
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += src[j];
    const mean = s / len;
    let q = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const d = src[j] - mean;
      q += d * d;
    }
    out[i] = Math.sqrt(q / len);
  }
}

/** Highest value over the last `len` bars. */
export function highest(src, len, out, from, n) {
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    let m = -Infinity;
    for (let j = i - len + 1; j <= i; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
}

/** Lowest value over the last `len` bars. */
export function lowest(src, len, out, from, n) {
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    let m = Infinity;
    for (let j = i - len + 1; j <= i; j++) if (src[j] < m) m = src[j];
    out[i] = m;
  }
}

/** (highest high + lowest low) / 2 over the last `len` bars. */
export function midpoint(high, low, len, out, from, n) {
  for (let i = from; i < n; i++) {
    if (i < len - 1) {
      out[i] = NaN;
      continue;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (high[j] > hi) hi = high[j];
      if (low[j] < lo) lo = low[j];
    }
    out[i] = (hi + lo) / 2;
  }
}

/** True range. */
export function trueRange(data, out, from, n) {
  const { high, low, close } = data;
  for (let i = from; i < n; i++) {
    const hl = high[i] - low[i];
    if (i === 0) {
      out[i] = hl;
      continue;
    }
    const pc = close[i - 1];
    out[i] = Math.max(hl, Math.abs(high[i] - pc), Math.abs(low[i] - pc));
  }
}
