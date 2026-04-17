const LOG_PATH = '/var/opt/MarkLogic/Logs'
const days = (typeof DAYS !== 'undefined') ? parseInt(DAYS) : 10
const KEYWORDS = ['jsengine', 'v8', 'xquery', 'endpoint', 'sjs']

const hosts = Array.from(xdmp.hosts()).map(h => xdmp.hostName(h).toString())

const allEvents = []

hosts.forEach(host => {
  const logDir = `${LOG_PATH}`
  const files = Array.from(xdmp.filesystemDirectory(logDir))
    .filter(x => {
      if (x.contentLength === 0) return false
      const filenameMatch = x.filename.match(/ErrorLog(_\d+)?\.txt$/)
      if (!filenameMatch) return false
      const suffix = filenameMatch[1]
      const dayIndex = suffix ? parseInt(suffix.substring(1)) : 0
      return dayIndex < days
    })
    .map(x => x.pathname)

  files.forEach(path => {
    const data = xdmp.filesystemFile(path).toString()
    const lines = data.split('\n').filter(l => l.trim())

    lines.forEach((line, idx) => {
      if (line.includes('Segmentation fault')) {
        const eventLines = [line]

        for (let i = 1; i <= 5 && idx + i < lines.length; i++) {
          eventLines.push(lines[idx + i])
        }

        for (let i = 1; i <= 100 && idx + i < lines.length; i++) {
          const l = lines[idx + i]
          if (l.includes('Critical:') && !eventLines.includes(l)) {
            eventLines.push(l)
          }
        }

        allEvents.push(eventLines)
      }
    })
  })
})

const byDate = {}
allEvents.forEach(eventLines => {
  const firstLine = eventLines[0]
  const day = firstLine.substring(0, 10)
  const minute = firstLine.substring(11, 16)
  if (!byDate[day]) {
    byDate[day] = {}
  }
  if (!byDate[day][minute]) {
    byDate[day][minute] = { messages: [], keywordCounts: {} }
  }

  const bucket = byDate[day][minute]
  eventLines.forEach(line => {
    bucket.messages.push(line)
    KEYWORDS.forEach(kw => {
      const regex = new RegExp(kw, 'gi')
      const matches = line.match(regex)
      if (matches) {
        bucket.keywordCounts[kw] = (bucket.keywordCounts[kw] || 0) + matches.length
      }
    })
  })
})

function packMinutes(minuteMap) {
  const minutes = Object.keys(minuteMap).sort()
  if (minutes.length === 0) return {}

  const packed = {}
  let rangeStart = minutes[0]
  let rangeEnd = minutes[0]
  const rangeMinutes = [minutes[0]]

  function flushRange() {
    const key = rangeStart === rangeEnd ? rangeStart : `${rangeStart}-${rangeEnd}`
    const messages = []
    const keywordCounts = {}
    rangeMinutes.forEach(m => {
      const bucket = minuteMap[m]
      messages.push(...bucket.messages)
      Object.keys(bucket.keywordCounts).forEach(kw => {
        keywordCounts[kw] = (keywordCounts[kw] || 0) + bucket.keywordCounts[kw]
      })
    })
    const keywords = Object.entries(keywordCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([kw, count]) => `${kw}(${count}x)`)
    packed[key] = { keywords, messages }
  }

  for (let i = 1; i < minutes.length; i++) {
    const prev = rangeEnd.split(':').map(Number)
    const curr = minutes[i].split(':').map(Number)
    const prevTotal = prev[0] * 60 + prev[1]
    const currTotal = curr[0] * 60 + curr[1]

    if (currTotal === prevTotal + 1) {
      rangeEnd = minutes[i]
      rangeMinutes.push(minutes[i])
    } else {
      flushRange()
      rangeStart = minutes[i]
      rangeEnd = minutes[i]
      rangeMinutes.length = 0
      rangeMinutes.push(minutes[i])
    }
  }
  flushRange()

  return packed
}

const result = {}
Object.keys(byDate).sort().forEach(day => {
  result[day] = packMinutes(byDate[day])
})

JSON.stringify(result, null, 2)
