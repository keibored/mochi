import { browserApi } from './chromeApi'
import { button, element, request } from './ui'
import type { Report } from './controller'

let busy = false
function render(report: Report) {
  element('status').textContent = report.status
  element('current').textContent = report.hostname ? `${report.hostname} · ${report.category}` : 'No eligible website is currently being counted.'
  const controls = element('controls')
  controls.replaceChildren()
  if (!report.state.enabled) controls.append(button('Enable tracking', () => void update('enable')))
  else {
    controls.append(button(report.state.paused ? 'Resume' : 'Pause', () => void update(report.state.paused ? 'resume' : 'pause')))
    const off = button('Turn tracking off', () => void update('disable'))
    off.className = 'secondary'
    controls.append(off)
  }
  const totals = element('totals')
  totals.replaceChildren()
  for (const category of ['Focus', 'Leisure', 'Neutral'] as const) {
    const row = document.createElement('div'), title = document.createElement('dt'), value = document.createElement('dd')
    title.textContent = category
    const seconds = Math.floor(report.totalsMs[category] / 1000)
    value.textContent = `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    row.append(title, value); totals.append(row)
  }
  element('empty').textContent = Object.values(report.totalsMs).every((total) => total === 0) ? 'No time recorded today. Enable tracking, categorize a website, and browse actively.' : 'Millisecond precision is retained locally; displayed seconds are rounded down.'
  const pairing = element('pairing')
  pairing.replaceChildren()
  const pending = report.state.pendingPairing
  pairing.hidden = !pending || pending.expiresAt <= Date.now()
  if (pending && !pairing.hidden) {
    const title = document.createElement('h2'), text = document.createElement('p'), actions = document.createElement('div')
    title.textContent = 'Allow local dashboard connection?'
    text.textContent = `Approve ${pending.origin} to receive category/time summaries. Website rules stay here. New connections start with future activity; existing totals and pet progress are preserved.`
    actions.className = 'actions'
    actions.append(button('Approve connection', () => void update('sync-approve', { requestId: pending.requestId })),
      button('Reject', () => void update('sync-reject', { requestId: pending.requestId })))
    pairing.append(title, text, actions)
  }
  element('extension-id').textContent = browserApi.runtime.id
  element('checked').textContent = `Last checked ${new Date(report.checkedAt).toLocaleTimeString()}. ${report.state.pairing ? 'Dashboard access has been approved; the web app verifies its live connection separately.' : 'No dashboard access approved.'}`
}
async function update(kind = 'report', fields: Record<string, string> = {}) {
  if (busy) return
  busy = true
  document.querySelectorAll<HTMLButtonElement>('button').forEach((control) => { control.disabled = true })
  try {
    const report = await request({ kind, ...fields })
    element('error').textContent = ''
    render(report)
  } catch (error) {
    element('status').textContent = 'Activity unavailable'
    element('current').textContent = 'Current activity could not be checked.'
    element('error').textContent = error instanceof Error ? error.message : 'Could not save local activity. Try again.'
    element('controls').replaceChildren(button('Retry', () => void update()))
  } finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach((control) => { control.disabled = false }) }
}
element('settings').addEventListener('click', () => { void browserApi.runtime.openOptionsPage().catch(() => { element('error').textContent = 'Could not open settings.' }) })
void update()
// UI refresh only while this popup is open; never a background accounting tick.
window.setInterval(() => { if (!document.hidden) void update() }, 5000)
