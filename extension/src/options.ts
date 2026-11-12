import { button, element, request } from './ui'
import type { Report } from './controller'
import { classificationForHostname, normalizeHostname } from '../../src/websiteRules'
import type { WebsiteRule } from '../../src/websiteRules'

let originalHostname: string | undefined
let busy = false
let rules: WebsiteRule[] = []
const hostname = element<HTMLInputElement>('hostname')
const category = element<HTMLSelectElement>('category')
function preview() {
  let text = 'Enter a website to see its current category. No override is needed to record time.'
  if (hostname.value.trim()) {
    try {
      const host = normalizeHostname(hostname.value)
      const current = classificationForHostname(rules, host)
      const automatic = classificationForHostname([], host)
      text = `${host}: ${current.category} · ${current.origin}. Without an override: ${automatic.category} · ${automatic.origin}.`
    } catch { text = 'Enter a valid hostname or HTTP(S) URL to preview its category.' }
  }
  element('classification-preview').textContent = text
}
function reset() {
  hostname.value = ''; category.value = 'Neutral'; originalHostname = undefined
  element('cancel-edit').hidden = true; element('save-rule').textContent = 'Save override ♡'
  preview()
}
function render(report: Report) {
  rules = report.state.rules
  const list = element('rules')
  list.replaceChildren()
  if (!report.state.rules.length) list.textContent = 'No overrides. Automatic categories apply; unknown and mixed-purpose websites still record Neutral time.'
  for (const rule of [...report.state.rules].sort((a, b) => a.hostname.localeCompare(b.hostname))) {
    const item = document.createElement('li'), text = document.createElement('strong'), controls = document.createElement('div')
    text.textContent = `${rule.hostname} · ${rule.category} · Your override`
    controls.className = 'actions'
    const edit = button(`Edit ${rule.hostname}`, () => {
      originalHostname = rule.hostname; hostname.value = rule.hostname; category.value = rule.category
      element('cancel-edit').hidden = false; element('save-rule').textContent = 'Save changes ♡'; hostname.focus()
      preview()
    })
    const remove = button(`Remove override for ${rule.hostname}`, () => void perform({ kind: 'rule-remove', hostname: rule.hostname }, 'Override removed. Automatic classification or Neutral fallback applies to future time. Past totals are unchanged.'))
    edit.className = remove.className = 'secondary'
    controls.append(edit, remove); item.append(text, controls); list.append(item)
  }
  preview()
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
  void perform({ kind: 'rule-save', hostname: hostname.value, category: category.value, originalHostname }, 'Override saved locally for future time only. Past totals are unchanged; web-app overrides are kept separately.')
})

hostname.addEventListener('input', preview)
element('cancel-edit').addEventListener('click', () => { reset(); hostname.focus() })
void perform({ kind: 'report' })
window.addEventListener('focus', () => { void perform({ kind: 'report' }) })
