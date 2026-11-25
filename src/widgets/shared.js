import { getLocale, setLocale } from '../core/i18n.js';
import { applyThemeVars } from '../core/styles.js';
import { resolveTheme } from '../core/theme.js';
import { DemoFeed } from '../data/feed.js';
import { widgetCss } from './styles.js';

/**
 * Shared foundation for the widgets.
 *   - one data feed is shared per page; setFeed() swaps in one for real data
 *   - each widget renders inside a Shadow DOM, so host CSS and widget CSS never affect each other
 *   - the UI language is page-wide too; changing it re-renders every widget
 */
let feed = null;

// The initial language follows the host page's <html lang> (or the browser language when unset).
if (typeof document !== 'undefined') {
  const pageLang = document.documentElement.lang || navigator.language || 'ja';
  setLocale(pageLang.toLowerCase().startsWith('ja') ? 'ja' : 'en');
}

/** The shared data feed. Synthetic data (DemoFeed) unless one is set. */
export function getFeed() {
  return (feed ??= new DemoFeed({ utcOffset: -new Date().getTimezoneOffset() * 60_000 }));
}

/**
 * Replace the data feed. Call before placing widgets.
 * It needs symbols / symbol(id) / timeframes(id) / history(id, tf) / subscribe(id, tf, onBar, history).
 */
export function setFeed(next) {
  feed = next;
}

const localeListeners = new Set();

/** Switch the UI language and notify every widget on the page. */
export function setWidgetLocale(lang) {
  const before = getLocale();
  const now = setLocale(lang);
  if (now !== before) for (const fn of [...localeListeners]) fn(now);
  return now;
}

/** Register a function to call when the language changes. Returns an unsubscribe function. */
export function onLocaleChange(fn) {
  localeListeners.add(fn);
  return () => localeListeners.delete(fn);
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Resolve 'auto' to 'light' / 'dark' from the OS setting. */
export function themeName(option) {
  if (option === 'light' || option === 'dark') return option;
  return darkQuery?.matches ? 'dark' : 'light';
}

/**
 * Prepare a place for a widget: attach a Shadow DOM to `container` and put a root element inside.
 * @param {HTMLElement} container
 * @param {string} className class for the root element
 * @param {{ theme?: string, scheme?: string }} options theme: 'light' | 'dark' | 'auto'
 * @returns {{ root: HTMLElement, theme: object, setTheme: (theme: string, scheme?: string) => object, onAuto: (fn: Function) => void, destroy: () => void }}
 */
export function mountWidget(container, className, options = {}) {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style');
  style.textContent = widgetCss;
  const root = document.createElement('div');
  root.className = `kw-root ${className}`;
  shadow.append(style, root);

  let themeOption = options.theme ?? 'auto';
  let scheme = options.scheme ?? 'wa';
  let autoListener = null;
  const mount = {
    root,
    theme: null,
    setTheme(theme = themeOption, nextScheme = scheme) {
      themeOption = theme;
      scheme = nextScheme;
      mount.theme = resolveTheme(themeName(themeOption), scheme);
      applyThemeVars(root, mount.theme);
      root.dataset.theme = mount.theme.name;
      root.style.colorScheme = mount.theme.name;
      return mount.theme;
    },
    /** Called when the OS switches light / dark while theme is 'auto'. */
    onAuto(fn) {
      autoListener = () => themeOption === 'auto' && fn(mount.setTheme());
      darkQuery?.addEventListener('change', autoListener);
    },
    destroy() {
      if (autoListener) darkQuery?.removeEventListener('change', autoListener);
      shadow.replaceChildren();
    },
  };
  mount.setTheme();
  return mount;
}

const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/**
 * Register a custom element. Attributes become options as they are (kebab-case → camelCase).
 * Changing an attribute recreates the widget; if create returns update(options), that is called instead.
 */
export function defineElement(tag, attributes, create) {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = attributes;
      #api = null;
      #timer = 0;

      get api() {
        return this.#api;
      }

      #options() {
        const out = {};
        for (const name of attributes) if (this.hasAttribute(name)) out[camel(name)] = this.getAttribute(name);
        return out;
      }

      connectedCallback() {
        this.#api = create(this, this.#options());
      }

      disconnectedCallback() {
        clearTimeout(this.#timer);
        this.#api?.destroy();
        this.#api = null;
      }

      attributeChangedCallback() {
        if (!this.#api) return;
        // batch several attribute changes in a row into one update
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
          if (!this.#api) return;
          if (this.#api.update) this.#api.update(this.#options());
          else {
            this.#api.destroy();
            this.#api = create(this, this.#options());
          }
        }, 0);
      }
    },
  );
}

/** 'a, b ,c' → ['a', 'b', 'c'] */
export const list = (value) => (Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean));

/** Truthiness of an attribute value (anything but 'false' / '0' / 'off' is true). */
export const flag = (value, fallback = true) => (value === undefined || value === null ? fallback : !['false', '0', 'off', 'no'].includes(String(value)));
