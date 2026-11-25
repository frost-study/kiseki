/**
 * UI language switching.
 *
 * Source strings are written in English. Other languages are looked up in a dictionary keyed by the
 * English text; a missing entry falls back to the English string. Definitions (series, indicators,
 * tools) just use plain English labels, and the text is passed through t() at the moment it is shown.
 *
 *   t('Candlestick')                          → 'ローソク足' (when the locale is 'ja')
 *   t('{n} drawings removed', { n: 3 })       → '3 件の描画を削除しました'
 *   t({ en: '1h', ja: '1時間' })              → per-language values can also be passed directly
 *
 * Plugins add their own translations with addMessages('ja', { 'English': '日本語' }) or pass { en, ja }.
 */
let locale = 'en';

const messages = {
  ja: {
    // ── Chart core ──
    'Jump to the latest bar': '最新のバーへ移動',
    'Show / hide': '表示 / 非表示',
    'Settings': '設定',
    'Remove': '削除',
    '{kind}: an id is required': '{kind}: id が必要です',
    'Unknown {kind}: {id}': '未登録の{kind}: {id}',
    'series type': 'シリーズ型',
    'drawing tool': '描画ツール',
    '{n} bars': '{n}本',

    // ── Legend labels ──
    'O': '始',
    'H': '高',
    'L': '安',
    'C': '終',
    'Price': '価格',
    'Size': '数量',
    'Total': '計',
    'Cell': 'マス',
    'Max': '最大',

    // ── Themes ──
    'Paper': '和紙',
    'Ink': '墨',
    'Vermilion & indigo (up = red / down = blue)': '朱と藍(上昇=朱 / 下落=藍)',
    'Green & red (up = green / down = red)': '緑と赤(上昇=緑 / 下落=赤)',
    'Ink tones (up = light / down = dark)': '墨の濃淡(上昇=淡 / 下落=濃)',

    // ── Chart types ──
    'Candlestick': 'ローソク足',
    'Hollow candles': '中空ローソク足',
    'Heikin-Ashi': '平均足',
    'Bars (OHLC)': 'バー (OHLC)',
    'High–low range': '高値・安値レンジ',
    'Line': 'ライン',
    'Step line': 'ステップライン',
    'Area': 'エリア',
    'Baseline': 'ベースライン',
    'Columns': 'カラム',

    // ── Indicators ──
    'indicator': 'インジケーター',
    'Length': '期間',
    'Source': 'ソース',
    'Trend': 'トレンド',
    'Volatility': 'ボラティリティ',
    'Oscillators': 'オシレーター',
    'Volume': '出来高',
    'Simple Moving Average': '単純移動平均',
    'Exponential Moving Average': '指数移動平均',
    'Weighted Moving Average': '加重移動平均',
    'Bollinger Bands': 'ボリンジャーバンド',
    'Deviations (σ)': '偏差(σ)',
    'Mid': '中',
    'Upper': '上',
    'Lower': '下',
    'Volume-Weighted Average Price': '出来高加重平均価格',
    'Anchor': '起点',
    'Auto': '自動',
    'Day': '日',
    'Week': '週',
    'Month': '月',
    'Ichimoku': '一目',
    'Ichimoku Cloud': '一目均衡表',
    'Conversion line': '転換線',
    'Base line': '基準線',
    'Leading span B': '先行スパンB',
    'Displacement': 'ずらし',
    'Conv': '転換',
    'Base': '基準',
    'Span A': '先行A',
    'Span B': '先行B',
    'Lag': '遅行',
    'Parabolic SAR': 'パラボリック SAR',
    'Start': '初期値',
    'Step': '加速',
    'Maximum': '上限',
    'Relative Strength Index': '相対力指数',
    'Fast': '短期',
    'Slow': '長期',
    'Signal': 'シグナル',
    'Hist': 'ヒスト',
    'Stochastic': 'ストキャスティクス',
    'Smoothing': '平滑',
    'Average True Range': 'アベレージ・トゥルー・レンジ',
    'On-Balance Volume': 'オン・バランス・ボリューム',
    'Volume Profile': '価格帯別出来高',
    'Rows': '段数',
    'Width (% of pane)': '横幅(パネル比 %)',
    'Value area (%)': 'バリューエリア(%)',
    'Side': '位置',
    'Left': '左',
    'Right': '右',
    'POC line': 'POC の線',
    'Show': '表示',
    'Hide': '非表示',
    'Volume Bubbles': '出来高バブル',
    'Largest radius (px)': '最大の半径(px)',
    'Minimum shown (% of max)': '表示する下限(最大比 %)',
    'Bubble position': '円の位置',
    'Volume Heatmap': '出来高ヒートマップ',
    'Cell height (px)': 'マスの高さ(px)',
    'Cell width (px, at least)': 'マスの幅(px 以上)',
    'Strength (%)': '濃さ(%)',
    'Shading': '濃淡のつけ方',
    'Standard (keeps small values visible)': '標準(少ない所も見える)',
    'Proportional (emphasizes large values)': '比例(多い所を強調)',

    // ── Drawing tools ──
    'Trend line': 'トレンドライン',
    'Ray': 'レイ(半直線)',
    'Extended line': '延長線',
    'Horizontal line': '水平線',
    'Vertical line': '垂直線',
    'Rectangle': '長方形',
    'Parallel channel': '平行チャネル',
    'Fibonacci retracement': 'フィボナッチ・リトレースメント',
    'Measure (price & time)': '計測(値幅・期間)',

    // ── Data ──
    'imported data': '取り込みデータ',
    'synthetic data': '合成データ',
    'Unknown symbol: {id}': '未知の銘柄: {id}',
    'The CSV has no rows': 'CSV に行がありません',
    'Columns "time" and "close" are required': 'time と close の列が必要です',
    'No readable rows were found': '読み取れる行がありませんでした',

    // ── Advanced chart UI ──
    'Close': '閉じる',
    'View controls': '表示の切り替え',
    'Switch symbol': '銘柄を切り替える',
    'Live playback speed': 'ライブの再生速度',
    'Start / stop the (synthetic) live feed': 'ライブ配信(合成)の開始 / 停止',
    'Live': 'ライブ',
    'Save as image': '画像として保存',
    'Switch theme (now: {name})': 'テーマを切り替える(いま: {name})',
    'All timeframes': 'すべての時間足',
    'Chart type': 'チャートの種類',
    'Visible range': '表示する期間',
    'Range': '範囲',
    'Add an indicator': 'インジケーターを追加',
    'Indicators': '指標',
    'Scale': '縦軸',
    'Linear': '線形',
    'Plain values': 'そのままの値で表示',
    'Log': '対数',
    'Logarithmic scale': '対数スケール',
    'Change since the start of the visible range': '表示範囲の先頭からの騰落率',
    'Fit the scale to the visible range': '縦軸を表示範囲に合わせる',
    'vs previous bar': '前の足比',
    'vs previous close': '前日比',
    'Import CSV…': 'CSV を読み込む…',
    'Last day': '直近 1 日',
    'Last 5 days': '直近 5 日',
    'Last month': '直近 1 か月',
    'Last 3 months': '直近 3 か月',
    'Last year': '直近 1 年',
    'All data': '全期間',
    'Real time': '実時間',
    'A 1-minute bar takes about 3 s': '1 分足が約 3 秒',
    'A 1-hour bar takes about 30 s': '1 時間足が約 30 秒',
    'For stress testing': '負荷テスト向き',
    'Theme': 'テーマ',
    'Language': '言語',
    'Candle colors': 'ローソク足の配色',
    'Controls guide': '操作ガイド',
    'Reset settings': '設定を初期化',
    'Search by name (e.g. moving average, RSI)': '名前で検索(例: 移動平均、RSI)',
    'Search indicators': 'インジケーターを検索',
    'Other': 'その他',
    'Added {name}': '{name} を追加しました',
    'overlay': 'チャートに重ねる',
    'separate pane': '専用パネル',
    '{n} active': '表示中 {n}',
    'No matching indicators': '該当するインジケーターがありません',
    'Open': '始値',
    'High': '高値',
    'Low': '安値',
    '(H+L)/2': '(高+安)/2',
    '(H+L+C)/3': '(高+安+終)/3',
    '(O+H+L+C)/4': '(始+高+安+終)/4',
    'Parameters': 'パラメータ',
    'Colors': '色',
    'Nothing to configure': '変更できる設定はありません',
    '{name} settings': '{name} の設定',
    'Reset': '既定に戻す',
    'Cursor (Esc)': 'カーソル (Esc)',
    'Magnet (snap to OHLC)': 'マグネット(四本値に吸着)',
    'Remove all drawings': '描画をすべて削除',
    '{n} drawings removed': '{n} 件の描画を削除しました',
    'Change color': '色を変える',
    'Default color': '既定の色',
    'Color {c}': '色 {c}',
    'Remove (Delete)': '削除 (Delete)',
    'ticks': 'ティック',
    'bars': '本',
    '{n} {unit} · {v} visible · draw {ms} ms': '{n} {unit} · 表示 {v} · 描画 {ms} ms',
    'Drop a CSV here to import it': 'CSV をここに置くと読み込みます',
    'Imported {name} ({n} rows)': '{name} を読み込みました({n} 行)',
    'Could not import: {msg}': '読み込めませんでした: {msg}',

    // ── Widgets ──
    'Range high': '期間高値',
    'Range low': '期間安値',
    'Spread': '値幅',
    'change over {range}': '{range}の変化',
    'Play': '流す',
    'Pause': '止める',
    'Up from the previous close': '前日比で上昇',
    'Down from the previous close': '前日比で下落',
    'Drag': 'ドラッグ',
    'Pan left and right (keeps gliding when released)': '左右に移動(離すと慣性で流れる)',
    'Wheel': 'ホイール',
    'Pinch': 'ピンチ',
    'Zoom around the cursor': 'カーソル位置を中心に拡大・縮小',
    'Drag the price axis': '縦軸をドラッグ',
    'Rescale prices (double-click to return to auto)': '値の縮尺を変える(ダブルクリックで自動に戻す)',
    'Drag the time axis': '時間軸をドラッグ',
    'Rescale time (double-click to reset)': '時間の縮尺を変える(ダブルクリックで初期表示)',
    'Drag a pane border': 'パネルの境界をドラッグ',
    'Resize panes': 'パネルの高さを変える',
    'Pan (hold Shift for bigger steps)': '左右に移動(Shift で大きく)',
    'Zoom in / out': '拡大・縮小',
    'Oldest / latest bar': '最古 / 最新のバーへ',
    'Cancel drawing / deselect': '作図を取り消す・選択を外す',
    'Remove the selected drawing': '選択中の描画を削除',
    'Drop a CSV': 'CSV をドロップ',
    'Import your own data (time, open, high, low, close, volume)': '手元のデータを読み込む(time, open, high, low, close, volume)',
  },
};

/** Switch the UI language: 'en', or any language that has a dictionary. */
export function setLocale(next) {
  locale = next === 'en' || messages[next] ? next : 'en';
  return locale;
}

export function getLocale() {
  return locale;
}

/** Add translations (for plugins). `map` is { 'English text': 'translation' }. */
export function addMessages(lang, map) {
  messages[lang] = { ...messages[lang], ...map };
}

/**
 * Return `text` in the current language.
 * @param {string | Record<string, string>} text English text, or per-language values such as { en, ja }
 * @param {Record<string, string | number>} [params] values for {name} placeholders
 */
export function t(text, params) {
  if (text == null) return '';
  let out;
  if (typeof text === 'object') out = text[locale] ?? text.en ?? text.ja ?? '';
  else out = locale === 'en' ? text : messages[locale]?.[text] ?? text;
  out = String(out);
  return params ? out.replace(/\{(\w+)\}/g, (m, key) => (key in params ? params[key] : m)) : out;
}
