// Google-Calendar-style layout for overlapping timed events. Events that
// (transitively) overlap form a cluster; each gets the first free column in
// its cluster, then widens rightwards over columns it doesn't collide with.
// `minDur` (hours) should match the minimum rendered height, so short events
// that visually touch are treated as overlapping.
// Returns Map(event → { left, width }) as fractions of the day column.
export function layoutOverlaps(events, minDur = 0.25) {
  const items = events
    .map(ev => ({ ev, start: ev.start, end: ev.start + Math.max(ev.dur, minDur) }))
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const out = new Map()
  const overlaps = (a, b) => a.start < b.end && b.start < a.end

  let cluster = [], clusterEnd = -Infinity
  const flush = () => {
    const cols = [] // cols[i] = items in column i
    for (const it of cluster) {
      let c = cols.findIndex(col => col.every(o => !overlaps(o, it)))
      if (c === -1) { c = cols.length; cols.push([]) }
      cols[c].push(it)
      it.col = c
    }
    const n = cols.length
    for (const it of cluster) {
      let span = 1
      while (it.col + span < n && cols[it.col + span].every(o => !overlaps(o, it))) span++
      out.set(it.ev, { left: it.col / n, width: span / n })
    }
    cluster = []
  }
  for (const it of items) {
    if (it.start >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return out
}

// Events that sit on the hour grid (not all-day, not the derived wake-up hint).
export const isTimed = ev => !ev.isAllDay && !ev.isSleepWakeUp && ev.start >= 0 && ev.start < 24

// The calendar's smallest block: 15 minutes.
export const SLOT = 0.25

// Where an event block sits in a column. Height is the event's real length
// (never padded out, so back-to-back 15-minute blocks stack instead of
// overlapping), with 1px of air above and below so adjacent blocks read as
// two. Under ~34px there's room for one line only.
export function eventBox(ev, hourH) {
  const dur = Math.max(ev.dur, SLOT)
  const height = dur * hourH - 2
  return { top: ev.start * hourH + 1, height, compact: height < 34 }
}

// Floor a pointer position (in hours) to the 15-minute slot it's in.
export const floorToSlot = h => Math.floor(h / SLOT) * SLOT
