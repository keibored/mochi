/** This local Brave integration is intentionally restricted to one origin.
 * A different hostname or port requires an explicit rebuild/configuration change.
 */
export const APP_ORIGIN = 'http://localhost:5173'
export const SYNC_PROTOCOL = 'mochi.sync'
export const SYNC_PROTOCOL_VERSION = 2
export const MIN_SYNC_EXTENSION_VERSION = '0.4.0'
export const REQUIRED_SYNC_CAPABILITIES = ['automatic-classification', 'revisioned-sync'] as const
