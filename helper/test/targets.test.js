import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRefs, findTarget } from '../src/browser.js'

const SNAP = `# Results
[e1] button "Select €14.99"
[e2] button "Select €16.59"
[e3] textbox "From" (value "Dublin "Heuston"", required)
[e4] select "Time" (selected "Now", options: Now | All day)
[f1e2] link "Help"`

test('parses refs, including names and states with quotes', () => {
  const r = parseRefs(SNAP)
  assert.deepEqual(r.get('e3'), { role: 'textbox', name: 'From' })
  assert.deepEqual(r.get('e4'), { role: 'select', name: 'Time' })
  assert.deepEqual(r.get('f1e2'), { role: 'link', name: 'Help' })
  assert.equal(r.size, 5)
})

test('finds targets: exact before contains, nth, regex, role aliases', () => {
  const r = parseRefs(SNAP)
  assert.equal(findTarget(r, { role: 'button', name: 'select' }), 'e1')
  assert.equal(findTarget(r, { role: 'button', name: 'select', nth: 1 }), 'e2')
  assert.equal(findTarget(r, { role: 'button', name: '16\\.59', match: 'regex' }), 'e2')
  assert.equal(findTarget(r, { role: 'button', name: 'Select', match: 'exact' }), null)
  assert.equal(findTarget(r, { role: 'combobox', name: 'time' }), 'e4')
  assert.equal(findTarget(r, { name: 'help' }), 'f1e2')
  assert.equal(findTarget(r, { role: 'button', name: '(', match: 'regex' }), null)
})
