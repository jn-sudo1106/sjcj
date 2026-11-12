export interface SseEvent {
  event: string
  data: string
}

export interface SseEventParser {
  push: (chunk: string) => SseEvent[]
  finish: () => SseEvent[]
}

export interface SseEventParserOptions {
  preserveDataLeadingSpace?: boolean
}

export function createSseEventParser(options: SseEventParserOptions = {}): SseEventParser {
  let buffer = ''
  let currentEvent = 'message'
  let dataLines: string[] = []
  let sawStructuredField = false

  function emitEvent(): SseEvent[] {
    if (!sawStructuredField && !dataLines.length && currentEvent === 'message') return []
    const event: SseEvent = { event: currentEvent || 'message', data: dataLines.join('\n') }
    currentEvent = 'message'
    dataLines = []
    sawStructuredField = false
    return [event]
  }

  function consumeLine(line: string): SseEvent[] {
    if (!line) return emitEvent()
    if (line.startsWith(':')) return []
    const colonIndex = line.indexOf(':')
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex)
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1)
    if (!options.preserveDataLeadingSpace || field !== 'data') {
      if (value.startsWith(' ')) value = value.slice(1)
    }
    switch (field) {
      case 'event':
        currentEvent = value || 'message'
        sawStructuredField = true
        return []
      case 'data':
        dataLines.push(value)
        sawStructuredField = true
        return []
      case 'id':
      case 'retry':
        sawStructuredField = true
        return []
      default:
        return []
    }
  }

  function push(chunk: string): SseEvent[] {
    if (!chunk) return []
    buffer += chunk
    const events: SseEvent[] = []
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      events.push(...consumeLine(line))
      newlineIndex = buffer.indexOf('\n')
    }
    return events
  }

  function finish(): SseEvent[] {
    const events = buffer ? push('\n') : []
    buffer = ''
    if (dataLines.length || currentEvent !== 'message' || sawStructuredField) {
      events.push(...emitEvent())
    }
    return events
  }

  return { push, finish }
}
