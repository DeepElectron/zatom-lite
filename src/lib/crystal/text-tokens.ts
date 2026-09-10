/** Tokens used by Zatom's quoted structure-text dialect (including its ID export). */
export function splitQuotedText(line: string, field: string, comments = false): string[] {
  const tokens: string[] = []
  let token = ''
  let started = false
  let quote: '"' | "'" | null = null
  let escaped = false
  const flush = () => {
    if (started) tokens.push(token)
    token = ''
    started = false
  }
  for (const char of line) {
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (!started && (char === '"' || char === "'")) {
      started = true
      quote = char
      continue
    }
    if (comments && char === '#') break
    if (/\s/.test(char)) flush()
    else {
      started = true
      token += char
    }
  }
  if (quote || escaped) throw new Error(`${field} contains an unterminated quoted value`)
  flush()
  return tokens
}
