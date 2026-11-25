import { t } from './i18n.js';

/**
 * Registry for extension points.
 * Series types, indicators and drawing tools are all created from definitions registered here.
 * Built-ins are registered through the same API, so plugins are treated exactly like them.
 */
export class Registry {
  #items = new Map();

  constructor(kind) {
    this.kind = kind;
  }

  register(def) {
    if (!def || !def.id) throw new Error(t('{kind}: an id is required', { kind: t(this.kind) }));
    this.#items.set(def.id, def);
    return def;
  }

  get(id) {
    const def = this.#items.get(id);
    if (!def) throw new Error(t('Unknown {kind}: {id}', { kind: t(this.kind), id }));
    return def;
  }

  has(id) {
    return this.#items.has(id);
  }

  list() {
    return [...this.#items.values()];
  }
}

export const seriesTypes = new Registry('series type');
export const indicators = new Registry('indicator');
export const drawingTools = new Registry('drawing tool');
