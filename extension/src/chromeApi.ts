/** Narrow structural typings for the Chrome APIs this PoC uses. No page APIs. */
export interface ChromeEvent<Args extends unknown[]> {
  addListener(listener: (...args: Args) => void): void
}
export interface Tab { id?: number; windowId: number; active: boolean; incognito: boolean; url?: string; status?: string }
export interface ChromeApi {
  tabs: {
    query(query: { active: boolean; windowId: number }): Promise<Tab[]>
    onActivated: ChromeEvent<[{ tabId: number; windowId: number }]>
    onUpdated: ChromeEvent<[number, { url?: string; status?: string }, Tab]>
    onRemoved: ChromeEvent<[number, { windowId: number; isWindowClosing: boolean }]>
  }
  windows: {
    getAll(query: { windowTypes: string[] }): Promise<{ id?: number; focused: boolean; incognito: boolean }[]>
    onFocusChanged: ChromeEvent<[number]>
    onRemoved: ChromeEvent<[number]>
  }
  idle: {
    queryState(seconds: number): Promise<'active' | 'idle' | 'locked'>
    setDetectionInterval(seconds: number): void
    onStateChanged: ChromeEvent<['active' | 'idle' | 'locked']>
  }
  storage: { local: {
    get(key: string): Promise<Record<string, unknown>>
    set(values: Record<string, unknown>): Promise<void>
  } }
  alarms: {
    get(name: string): Promise<{ name: string } | undefined>
    create(name: string, info: { periodInMinutes: number }): Promise<void>
    onAlarm: ChromeEvent<[{ name: string }]>
  }
  runtime: {
    id: string
    getURL(path: string): string
    onStartup: ChromeEvent<[]>
    onInstalled: ChromeEvent<[{ reason: string }]>
    onMessage: { addListener(listener: (message: unknown, sender: { id?: string; url?: string }, reply: (response: unknown) => void) => boolean): void }
    sendMessage(message: unknown): Promise<unknown>
    openOptionsPage(): Promise<void>
  }
}

declare const chrome: ChromeApi
export const browserApi = chrome
