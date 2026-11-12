import { TrackerController } from './controller.ts'
import type { ChromeApi } from './chromeApi'
import type { Clock } from './controller'
import { IDLE_SECONDS } from './model.ts'

export const CHECKPOINT_ALARM = 'mochi-checkpoint'

/** Register listeners synchronously so Chrome can wake a dormant worker. */
export function registerWorker(api: ChromeApi, clock: Clock): TrackerController {
  const tracker = new TrackerController(api, clock)
  const checkpoint = () => { void tracker.run() }
  api.tabs.onActivated.addListener(checkpoint)
  api.tabs.onUpdated.addListener((_id, changes) => { if (changes.url !== undefined || changes.status !== undefined) checkpoint() })
  api.tabs.onRemoved.addListener(checkpoint)
  api.windows.onRemoved.addListener(checkpoint)
  api.windows.onFocusChanged.addListener((id) => { void tracker.run({ kind: 'report' }, { unfocused: id === -1 }) })
  api.idle.onStateChanged.addListener((idle) => { void tracker.run({ kind: 'report' }, { idle }) })
  api.alarms.onAlarm.addListener((alarm) => { if (alarm.name === CHECKPOINT_ALARM) checkpoint() })
  const recover = () => { void tracker.run({ kind: 'report' }, { recovery: true }) }
  api.runtime.onStartup.addListener(recover)
  api.runtime.onInstalled.addListener(recover)
  api.runtime.onMessage.addListener((request, sender, reply) => {
    // Only bundled extension pages may change preferences or approve a pair.
    // The separately validated external route below has no such privileges.
    if (sender.id !== api.runtime.id || ![api.runtime.getURL('popup.html'), api.runtime.getURL('options.html')].includes(sender.url ?? '')) return false
    void tracker.run(request).then(reply)
    return true
  })
  api.runtime.onMessageExternal?.addListener((request, sender, reply) => {
    void tracker.external(request, sender).then(reply)
    return true
  })
  api.idle.setDetectionInterval(IDLE_SECONDS)
  // Alarms can be cleared on restart/update. Recreate a missing one on every
  // worker load; do not reset an existing alarm and postpone its deadline.
  void api.alarms.get(CHECKPOINT_ALARM).then((alarm) => {
    if (!alarm) return api.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: 0.5 })
  }).catch(() => { /* Events and popup checkpoints still work if alarms fail. */ })
  checkpoint() // Discard the old worker's unverified tail before any new interval.
  return tracker
}
