// Text inside a calendar event block. Short blocks (15–30 min) get a single
// line, "Standup · 9:15 AM"; taller ones get the title (wrapping if there's
// room) with the time underneath.
export default function EventLabel({ ev, height, compact, size = 12, prefix = '' }) {
  const time = ev.timeDisplay || ev.time
  if (compact) {
    // One line, exactly the block's height. The row wraps, and anything past
    // the first line is clipped: so the time shows whole when it fits beside
    // the title, and drops out of sight (rather than being cut mid-digit) when
    // it doesn't. The title alone shrinks with an ellipsis.
    const line = { lineHeight: `${height}px`, whiteSpace: 'nowrap' }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', columnGap: 5, height: '100%', overflow: 'hidden', minWidth: 0, color: ev.color, fontSize: Math.min(size, Math.max(height - 3, 9.5)) }}>
        <span style={{ ...line, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>{prefix}{ev.title}</span>
        {time && <span style={{ ...line, opacity: .75, flex: 'none' }}>{time}</span>}
      </div>
    )
  }
  const lines = Math.max(1, Math.floor((height - 22) / (size + 3)))
  return (
    <>
      <div style={{ fontSize: size, fontWeight: 600, lineHeight: 1.25, color: ev.color, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
        {prefix}{ev.title}
      </div>
      <div style={{ fontSize: size - 1.5, color: ev.color, opacity: .8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.time || ev.timeDisplay}</div>
    </>
  )
}
