import { button, element, request } from './ui'
import type { Report } from './controller'

let originalHostname: string | undefined
let busy = false
const hostname = element<HTMLInputElement>('hostname')
const category = element<HTMLSelectElement>('category')
function reset() {
  hostname.value = ''; category.value = 'Neutral'; originalHostname = undefined
  element('cancel-edit').hidden = true; element('save-rule').textContent = 'Save rule ♡'
}
function render(report: Report) {
  const list = element('rules')
  list.replaceChildren()
  if (!report.state.rules.length) list.textContent = 'No rules yet. Unknown hostnames are Neutral.'
  for (const rule of [...report.state.rules].sort((a, b) => a.hostname.localeCompare(b.hostname))) {
    const item = document.createElement('li'), text = document.createElement('strong'), controls = document.createElement('div')
    text.textContent = `${rule.hostname} · ${rule.category}`
    controls.className = 'actions'
    const edit = button(`Edit ${rule.hostname}`, () => {
      originalHostname = rule.hostname; hostname.value = rule.hostname; category.value = rule.category
      element('cancel-edit').hidden = false; element('save-rule').textContent = 'Save changes ♡'; hostname.focus()
    })
    const remove = button(`Remove ${rule.hostname}`, () => void perform({ kind: 'rule-remove', hostname: rule.hostname }, 'Rule removed. Past totals are unchanged.'))
    edit.className = remove.className = 'secondary'
    controls.append(edit, remove); item.append(text, controls); list.append(item)
  }
}
async function perform(command: unknown, feedback = '') {
  if (busy) return
  busy = true
  element<HTMLButtonElement>('save-rule').disabled = true
  try {
    render(await request(command))
    element('error').textContent = ''; hostname.setAttribute('aria-invalid', 'false')
    if (feedback) { reset(); element('feedback').textContent = feedback; hostname.focus() }
  } catch (error) {
    element('error').textContent = error instanceof Error ? error.message : 'Could not update rules.'
    hostname.setAttribute('aria-invalid', 'true')
  } finally { busy = false; element<HTMLButtonElement>('save-rule').disabled = false }
}
element('rule-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void perform({ kind: 'rule-save', hostname: hostname.value, category: category.value, originalHostname }, 'Rule saved locally. It applies only to future time; web-app rules are not synchronized.')
})
element('cancel-edit').addEventListener('click', () => { reset(); hostname.focus() })
void perform({ kind: 'report' })
window.addEventListener('focus', () => { void perform({ kind: 'report' }) })
