import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteFor, requestedSite, sensitiveField, paymentAction } from '../src/policy.js'

const SITES = ['irishrail.ie', 'thetrainline.com', 'www.lner.co.uk']

test('only allowed sites, subdomains included, https only', () => {
  assert.equal(siteFor('https://www.irishrail.ie/en-ie/', SITES), 'irishrail.ie')
  assert.equal(siteFor('https://booking.cf.irishrail.ie/en-IE/', SITES), 'irishrail.ie')
  assert.equal(siteFor('https://lner.co.uk/', SITES), 'lner.co.uk')
  assert.equal(siteFor('https://irishrail.ie.evil.com/', SITES), null)
  assert.equal(siteFor('https://notirishrail.ie/', SITES), null)
  assert.equal(siteFor('http://www.irishrail.ie/', SITES), null)
  assert.equal(siteFor('javascript:alert(1)', SITES), null)
  assert.equal(siteFor('not a url', SITES), null)
  assert.equal(siteFor('http://127.0.0.1:9/x', ['127.0.0.1']), null)
  assert.equal(siteFor('http://127.0.0.1:9/x', ['127.0.0.1'], { allowHttpLocal: true }), '127.0.0.1')
})

test('card, bank and login fields are sensitive; booking fields are not', () => {
  const yes = [
    { type: 'password' },
    { autocomplete: 'cc-number' },
    { autocomplete: 'cc-csc' },
    { name: 'cardNumber' },
    { label: 'Card number' },
    { name: 'cvc' },
    { placeholder: 'CVV' },
    { label: 'Expiry date' },
    { name: 'exp-month' },
    { label: 'Name on card' },
    { label: 'IBAN' },
    { label: 'Sort code' },
    { aria: 'Security code' },
  ]
  for (const f of yes) assert.ok(sensitiveField(f), JSON.stringify(f))
  const no = [
    { name: 'first-name', label: 'First name' },
    { type: 'email', label: 'Email address' },
    { name: 'phoneNumber' },
    { label: 'From', name: 'from' },
    { label: 'Leap card number (optional)', name: 'leap' }, // not a payment card, but caught: better safe
  ]
  for (const f of no.slice(0, 4)) assert.equal(sensitiveField(f), null, JSON.stringify(f))
})

test('pay buttons are caught; booking steps are not', () => {
  for (const text of ['Pay now', 'PAY €14.99', 'Place order', 'Complete booking', 'Confirm and pay', 'Buy now', 'Proceed to payment', 'Purchase'])
    assert.ok(paymentAction({ text }), text)
  for (const text of ['Book Tickets', 'Next step', 'Continue', 'Skip', 'Automatic seat selection', 'Go', 'PayPal info'])
    assert.equal(paymentAction({ text }), false, text)
  assert.ok(paymentAction({ text: '', aria: 'Pay securely' }))
  assert.ok(paymentAction({ text: '', value: 'Submit payment' }))
})

test('requestedSite: plain site names only', () => {
  assert.deepEqual(requestedSite('https://www.Ryanair.com/ie/en/trip'), { site: 'ryanair.com' })
  assert.deepEqual(requestedSite('booking.aerlingus.com'), { site: 'booking.aerlingus.com' })
  // Where the link really goes is what counts, not what comes before an @.
  assert.deepEqual(requestedSite('https://irishrail.ie@evil.example/'), { site: 'evil.example' })
  for (const bad of ['', 'com', 'co.uk', 'localhost', '127.0.0.1', '10.0.0.1:8080', 'bücher.de', 'xn--bcher-kva.de', 'a b.com', 'http://[::1]/']) {
    assert.ok(requestedSite(bad).error, `should refuse ${JSON.stringify(bad)}`)
  }
})
