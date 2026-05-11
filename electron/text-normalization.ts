export type TextNormalizationKind = 'assistant' | 'tool-args' | 'tool-result' | 'stderr'

const REPLACEMENT_CHARACTER = '\uFFFD'
const CONTROL_CHARS_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const COMMON_MOJIBAKE_PATTERNS = [
  /(?:Ã.|Â.|â€|â€™|â€œ|â€�|â€¦)/,
  /(?:涓|绋|妗|鏃|鍙|杩|浠|鐨|绌|鎴|瀹|鍏|鍦|淇|涓|侊)/,
  /(?:ļ|ѱ|汾|ҳ|Ӧ|ʵ|Ƿ)/,
]

export function normalizeTextForDisplay(value: string, kind: TextNormalizationKind = 'tool-result') {
  const cleaned = value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARS_EXCEPT_WHITESPACE, '')

  if (!cleaned) {
    return cleaned
  }

  const warnings: string[] = []

  if (cleaned.includes(REPLACEMENT_CHARACTER)) {
    warnings.push('replacement characters were found')
  }

  if (looksLikeMojibake(cleaned)) {
    warnings.push('text looks like it may have been decoded with the wrong code page')
  }

  if (warnings.length === 0) {
    return cleaned
  }

  return [
    `[Hermes Desktop encoding notice: ${kind}; ${warnings.join('; ')}. Prefer UTF-8 tool output.]`,
    cleaned,
  ].join('\n')
}

export function normalizeMaybeText(value: string | undefined, kind: TextNormalizationKind) {
  return value === undefined ? undefined : normalizeTextForDisplay(value, kind)
}

export function looksLikeMojibake(value: string) {
  if (!value) {
    return false
  }

  const suspiciousPatternHit = COMMON_MOJIBAKE_PATTERNS.some((pattern) => pattern.test(value))
  const replacementRatio = countOccurrences(value, REPLACEMENT_CHARACTER) / value.length

  return suspiciousPatternHit || replacementRatio > 0.005
}

function countOccurrences(value: string, needle: string) {
  let count = 0
  let index = 0

  while ((index = value.indexOf(needle, index)) !== -1) {
    count += 1
    index += needle.length
  }

  return count
}
