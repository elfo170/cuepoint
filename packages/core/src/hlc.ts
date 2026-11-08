/**
 * Hybrid Logical Clock.
 *
 * Formato textual: `<ms:15 dígitos>:<contador:6 dígitos>:<nó>` — a comparação lexicográfica
 * das strings equivale à ordem do relógio (desempate pelo id do nó).
 */
export type Hlc = string;

export interface HlcParts {
  ms: number;
  counter: number;
  node: string;
}

const MS_DIGITS = 15;
const COUNTER_DIGITS = 6;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;
/** Tolerância a relógios adiantados de outros aparelhos (1 dia). */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

export function formatHlc({ ms, counter, node }: HlcParts): Hlc {
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`HLC inválido: ms=${ms}`);
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER)
    throw new Error(`HLC inválido: counter=${counter}`);
  if (!node || node.includes(':')) throw new Error(`HLC inválido: node=${node}`);
  return `${String(ms).padStart(MS_DIGITS, '0')}:${String(counter).padStart(COUNTER_DIGITS, '0')}:${node}`;
}

export function parseHlc(hlc: Hlc): HlcParts {
  const m = /^(\d{15}):(\d{6}):([^:]+)$/.exec(hlc);
  if (!m) throw new Error(`HLC inválido: ${hlc}`);
  return { ms: Number(m[1]), counter: Number(m[2]), node: m[3]! };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxHlc(a: Hlc | null | undefined, b: Hlc | null | undefined): Hlc | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Data/hora ISO correspondente ao componente físico do HLC. */
export function hlcToIso(hlc: Hlc): string {
  return new Date(parseHlc(hlc).ms).toISOString();
}

export class HlcClock {
  private ms: number;
  private counter: number;

  constructor(
    readonly node: string,
    last: Hlc | null = null,
    readonly now: () => number = Date.now,
  ) {
    const parts = last ? parseHlc(last) : { ms: 0, counter: 0 };
    this.ms = parts.ms;
    this.counter = parts.counter;
  }

  /** Último valor emitido/observado. */
  get last(): Hlc {
    return formatHlc({ ms: this.ms, counter: this.counter, node: this.node });
  }

  /** Gera um novo timestamp para um evento local. */
  tick(): Hlc {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.bump();
    }
    return this.last;
  }

  /** Incorpora um timestamp recebido de outro aparelho. */
  receive(remote: Hlc): void {
    const r = parseHlc(remote);
    const wall = this.now();
    if (r.ms > wall + MAX_DRIFT_MS) {
      throw new Error(`HLC remoto muito adiantado (${remote}); verifique o relógio do aparelho`);
    }
    if (wall > this.ms && wall > r.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (r.ms > this.ms) {
      this.ms = r.ms;
      this.counter = r.counter;
      this.bump();
    } else if (r.ms === this.ms) {
      this.counter = Math.max(this.counter, r.counter);
      this.bump();
    } else {
      this.bump();
    }
  }

  private bump(): void {
    if (this.counter >= MAX_COUNTER) {
      this.ms += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
  }
}
