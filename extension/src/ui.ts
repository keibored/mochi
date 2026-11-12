import { browserApi } from './chromeApi'
import type { Report, Response } from './controller'
import './style.css'

export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing UI element: ${id}`)
  return found as T
}
export function button(label: string, action: () => void): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = 'button'
  control.textContent = label
  control.addEventListener('click', action)
  return control
}
export async function request(command: unknown): Promise<Report> {
  let response: Response
  try { response = await browserApi.runtime.sendMessage(command) as Response } catch {
    throw new Error('The extension worker is unavailable. Reload this extension in chrome://extensions and try again.')
  }
  if (!response || !response.ok) throw new Error(response && !response.ok ? response.error : 'No response from the extension worker.')
  return response.report
}
