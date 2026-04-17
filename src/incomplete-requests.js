const LOG_PATH = '/var/opt/MarkLogic/Logs'
const days = (typeof DAYS !== 'undefined') ? parseInt(DAYS) : 1

const hosts = Array.from(xdmp.hosts()).map(h => xdmp.hostName(h).toString())

const startsMap = new Map()
const endsSet = new Set()

hosts.forEach(host => {
  const logDir = `${LOG_PATH}`
  const files = Array.from(xdmp.filesystemDirectory(logDir))
    .filter(x => {
      if (x.contentLength === 0) return false
      const match = x.filename.match(/_ErrorLog(_\d+)?\.txt$/)
      if (!match) return false
      const suffix = match[1]
      const dayIndex = suffix ? parseInt(suffix.substring(1)) : 0
      return dayIndex < days
    })
    .map(x => x.pathname)

  files.forEach(path => {
    const data = xdmp.filesystemFile(path).toString()
    const lines = data.split('\n')

    lines.forEach(line => {
      if (!line.trim()) return

      const txnMatch = line.match(/txn=(\d+)/)
      if (!txnMatch) return

      const txn = txnMatch[1]

      if (line.endsWith(' starts')) {
        const portMatch = line.match(/port=(\d+)/)
        const port = portMatch ? portMatch[1] : 'unknown'
        const date = line.substring(0, 23)
        startsMap.set(txn, { line, port, date })
      } else if (line.endsWith(' ends') || line.includes('error=')) {
        endsSet.add(txn)
      }
    })
  })
})

const incomplete = []
startsMap.forEach((entry, txn) => {
  if (!endsSet.has(txn)) {
    incomplete.push(entry)
  }
})

incomplete.sort((a, b) => a.date.localeCompare(b.date))

const byPort = {}
incomplete.forEach(entry => {
  const day = entry.date.substring(0, 10)
  const time = entry.date.substring(11, 16)
  if (!byPort[entry.port]) {
    byPort[entry.port] = {}
  }
  if (!byPort[entry.port][day]) {
    byPort[entry.port][day] = {}
  }
  if (!byPort[entry.port][day][time]) {
    byPort[entry.port][day][time] = []
  }
  byPort[entry.port][day][time].push(entry.line)
})

JSON.stringify(byPort, null, 2)
