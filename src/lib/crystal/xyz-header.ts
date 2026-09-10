export interface XyzHeaderEntry {
  key: string
  value: string
  quoted: boolean
}

/** Read top-level assignments only. Containers stay opaque; this is not an
 * extXYZ array/type parser. Free XYZ title words remain ordinary comment text.
 */
export function readXyzHeader(comment: string): XyzHeaderEntry[] {
  const entries: XyzHeaderEntry[] = []
  let cursor = 0
  const whitespace = () => { while (cursor < comment.length && /\s/.test(comment[cursor])) cursor++ }
  const token = (key = false) => {
    const start = cursor, brackets: string[] = []
    let quote = '', escaped = false, valid = true, closingQuote = -1
    while (cursor < comment.length) {
      const char = comment[cursor]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) { quote = ''; closingQuote = cursor }
      } else if ((char === '"' || char === "'") && (cursor === start || brackets.length)) quote = char
      else if (char === '[' || char === '{') brackets.push(char === '[' ? ']' : '}')
      else if (char === ']' || char === '}') { if (brackets.pop() !== char) valid = false }
      else if (!brackets.length && (/\s/.test(char) || (key && char === '='))) break
      else if (!brackets.length && char === '=') valid = false
      cursor++
    }
    const raw = comment.slice(start, cursor)
    const quoted = raw.startsWith('"') || raw.startsWith("'")
    valid &&= Boolean(raw) && !quote && !escaped && !brackets.length && (!quoted || closingQuote === cursor - 1)
    return { value: quoted && valid ? raw.slice(1, -1) : raw, quoted, valid }
  }
  while (cursor < comment.length) {
    whitespace()
    if (cursor >= comment.length) break
    const key = token(true)
    // An isolated '=' is just malformed comment text, not an infinite loop.
    if (!key.value) { cursor++; continue }
    whitespace()
    if (comment[cursor] !== '=') continue
    cursor++; whitespace()
    const value = token()
    if (key.valid && !key.quoted && /^[A-Za-z_][\w.-]*$/.test(key.value)) {
      // A missing value must not swallow the next `Lattice=...` assignment.
      // Unquoted '=' is not a primitive value; arbitrary text can be quoted.
      if (!value.valid) throw new Error(`extXYZ ${key.value} has an incomplete or malformed value`)
      entries.push({ key: key.value.toLowerCase(), value: value.value, quoted: value.quoted })
    }
  }
  return entries
}

/** Structural fields must be unique, complete assignments, never substrings of
 * another value. Presence with an empty value remains distinct from absence.
 */
export function xyzHeaderValue(header: readonly XyzHeaderEntry[], key: string): string | undefined {
  const entries = header.filter(entry => entry.key === key.toLowerCase())
  if (entries.length > 1) throw new Error(`extXYZ ${key} is declared more than once`)
  return entries[0]?.value
}
