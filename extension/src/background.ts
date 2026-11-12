import { browserApi } from './chromeApi'
import { registerWorker } from './worker'

registerWorker(browserApi, {
  now: () => Date.now(), monotonic: () => performance.now(), id: () => crypto.randomUUID(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
})
