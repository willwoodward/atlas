// Default empty-state data for the Atlas personal dashboard.
// Replace these with real data sources / API calls.

export const pal = {
  coral: { c: '#c15f3c', t: 'rgba(193,95,60,.13)' },
  sage:  { c: '#6f8168', t: 'rgba(111,129,104,.16)' },
  blue:  { c: '#5f7591', t: 'rgba(95,117,145,.16)' },
  gold:  { c: '#b08a3e', t: 'rgba(176,138,62,.16)' },
  mauve: { c: '#9a6d84', t: 'rgba(154,109,132,.16)' },
}

export const user = { name: '—', email: '—', initials: '—' }

export const dateLabel = '—'

export const stats = [
  { label: 'Focus today', value: '—', sub: '', tone: '#9a9488' },
  { label: 'Habits',      value: '—', sub: '', tone: '#9a9488' },
  { label: 'Net worth',   value: '—', sub: '', tone: '#9a9488' },
  { label: 'To-dos left', value: '—', sub: '', tone: '#9a9488' },
]

// Schedule blocks: { time, dur, title, tag, color, tint }
export const schedule = []

// Tablet agenda: 2-day list view
export const agendaDays = [
  { label: 'Today',    date: '—', accent: '#c15f3c', items: [] },
  { label: 'Tomorrow', date: '—', accent: '#6f8168', items: [] },
]

// Desktop calendar week view
export const calDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(dow => ({
  dow, num: '—', today: false, events: [],
}))
export const calHours = Array.from({ length: 14 }, (_, i) => `${i + 7}:00`)

// Goals: { title, pct, color, note }
export const goals = []

// Goals full cards: { cat, title, note, pct, metric, metricLabel, due, color }
export const goalsFull = []

// Todos: { title, tag, done }
export const todos = []
export const todoGroups = [
  { title: 'Today',     color: '#c15f3c', count: '—', items: [] },
  { title: 'This week', color: '#5f7591', count: '—', items: [] },
  { title: 'Someday',   color: '#b08a3e', count: '—', items: [] },
]

// Habits: { name, color, streak, pct, week: [{done}x7], history: [{done}x30] }
export const habits = []

// Notes: { title, body, date, tag, color }
export const notes = []

// Finance data
export const finances = {
  netWorth:            '—',
  netWorthChange:      '—',
  netWorthPositive:    true,
  income:              '—',
  spending:            '—',
  saved:               '—',
  savingsRate:         0,
  nwPoints:            '0,28 240,28',   // flat sparkline
  cashflowMonths:      [],              // { label, inH, exH }
  accounts:            [],              // { name, bank, bal, color, balColor }
  pieGrad:             '#ece7dc',
  pieLegend:           [],              // { name, color, amt, pct }
  transactions:        [],              // { merchant, cat, date, amt, color, amtColor }
}

export const assistantPrompts = [
  'Plan my week',
  'Where did my money go?',
  'How are my habits?',
]
