/** ISO-3166 alpha-2 → regional-indicator flag emoji. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '🏳️'
  const upper = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return '🏳️'
  const A = 0x1f1e6
  return String.fromCodePoint(A + (upper.charCodeAt(0) - 65), A + (upper.charCodeAt(1) - 65))
}
