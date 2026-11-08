/**
 * Chaves fracionárias para ordenar itens (posição em playlists).
 * Inserir entre duas chaves gera uma nova chave sem renumerar as outras, o que evita conflitos
 * quando aparelhos diferentes reordenam a mesma lista. Ordem = comparação lexicográfica.
 */
export const FRACTIONAL_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function midpoint(a: string, b: string | null, digits: string): string {
  if (b !== null && a >= b) throw new Error(`chaves fora de ordem: ${a} >= ${b}`);
  if (a.endsWith('0') || (b !== null && b.endsWith('0'))) {
    throw new Error('chave fracionária não pode terminar em 0');
  }
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
  }
  const digitA = a ? digits.indexOf(a[0]!) : 0;
  const digitB = b !== null ? digits.indexOf(b[0]!) : digits.length;
  if (digitB - digitA > 1) {
    return digits[Math.round(0.5 * (digitA + digitB))]!;
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return digits[digitA]! + midpoint(a.slice(1), null, digits);
}

/** Chave estritamente entre `a` e `b` (null = início/fim da lista). */
export function keyBetween(a: string | null, b: string | null): string {
  return midpoint(a ?? '', b, FRACTIONAL_DIGITS);
}

/** Valida o formato (alfabeto e sem zero final). */
export function isValidFractionalKey(key: string): boolean {
  return (
    key.length > 0 && !key.endsWith('0') && [...key].every((c) => FRACTIONAL_DIGITS.includes(c))
  );
}
