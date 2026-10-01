/**
 * Generic capability registry. Every pluggable system (scenes, transitions,
 * text motion, sound families, visualizations, illustrations, modules) is a
 * registry of entries that declare an id and what they can do. The engine
 * only ever looks things up here — adding an entry never touches the core.
 *
 *   TransitionRegistry.register({ id: 'whip', ... })
 *   TextMotionRegistry.get('mask-reveal')
 *   SoundFamilyRegistry.where((f) => f.intents.includes('impact'))
 */
export interface RegistryEntry {
  id: string;
}

export class CapabilityRegistry<T extends RegistryEntry> {
  private map = new Map<string, T>();
  private aliases = new Map<string, string>();
  constructor(readonly kind: string) {}

  register(entry: T, aliases: string[] = []): T {
    if (this.map.has(entry.id)) throw new Error(`${this.kind} "${entry.id}" is already registered`);
    this.map.set(entry.id, entry);
    for (const a of aliases) this.aliases.set(a, entry.id);
    return entry;
  }

  /** Register or replace (plugins overriding a builtin). */
  upsert(entry: T): T {
    this.map.set(entry.id, entry);
    return entry;
  }

  alias(alias: string, id: string): void {
    if (!this.map.has(id)) throw new Error(`Cannot alias "${alias}" to unknown ${this.kind} "${id}"`);
    this.aliases.set(alias, id);
  }

  resolveId(id: string): string | undefined {
    return this.map.has(id) ? id : this.aliases.get(id);
  }

  get(id: string | undefined): T | undefined {
    if (!id) return undefined;
    const r = this.resolveId(id);
    return r ? this.map.get(r) : undefined;
  }

  require(id: string): T {
    const e = this.get(id);
    if (!e) throw new Error(`Unknown ${this.kind} "${id}". Known: ${this.ids().join(', ')}`);
    return e;
  }

  has(id: string | undefined): boolean {
    return Boolean(id && this.resolveId(id));
  }

  list(): T[] {
    return [...this.map.values()];
  }

  ids(): string[] {
    return [...this.map.keys()];
  }

  where(pred: (e: T) => boolean): T[] {
    return this.list().filter(pred);
  }

  get size(): number {
    return this.map.size;
  }
}
