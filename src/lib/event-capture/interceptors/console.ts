export const CONSOLE_EVENT_NAME = 'janus:console-event'

export function patchConsole(doc: Document): () => void {
  const seen = new Set<string>()
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  function emit(level: 'error' | 'warn', args: unknown[]) {
    const message = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')
    const key = `${level}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    doc.dispatchEvent(new CustomEvent(CONSOLE_EVENT_NAME, { detail: JSON.stringify({ level, message }) }))
  }

  console.error = (...args: unknown[]) => { origError(...args); emit('error', args) }
  console.warn = (...args: unknown[]) => { origWarn(...args); emit('warn', args) }

  return () => { console.error = origError; console.warn = origWarn }
}
