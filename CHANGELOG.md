# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-09-07

### Added
- Delivery confirmation — the service worker reports notifications it displays, so the dashboard shows `delivered`, not just `sent`.
- Automatic re-subscription when the browser rotates a push subscription (`pushsubscriptionchange`). Previously the stale endpoint kept failing and notifications silently stopped.

### Fixed
- Subscriptions created with an old VAPID key are now detected and recreated. They previously looked valid while every send was rejected.
- Android Chrome silently dropping notifications: each push now gets a unique `tag` (a fixed tag collapsed them all into one slot), `renotify` is set so Chrome surfaces them while backgrounded, and icons fall back to a real file since a 404 icon makes Android discard the notification.
- `showNotification` is retried without optional fields if the first call fails, instead of failing silently.

### Added (cont.)
- The worker mirrors each push to visible pages via `postMessage` (`type: 'rivium-push-message'`), so in-app UI still updates when the page-side connection is asleep. Dedupe by `messageId`.

### Upgrading
Copy the updated `service-worker.js` to your public directory — the new handlers live in that file.

## [0.1.3] - 2026-08-23

### Added
- Device attributes (language, country, timezone) are now sent automatically on every `register()` call. Use them as preset filters in the dashboard's segment builder to target specific locales, regions, or timezones — no need to populate metadata yourself.
- New optional `appVersion` field on `RiviumPushConfig`. Set it at init time (e.g., from your build config) and target specific releases as a preset segment filter.

### Deprecated
- `metadata.language` is deprecated in favor of the new top-level `Language` preset filter. Existing segments that filter on `metadata.language` keep working — the field is still populated. Migrate to the preset filter in a future release; `metadata.language` will be removed in a later version.

## [0.1.2] - 2026-08-17

### Fixed
- iOS Safari PWA backgrounding produced console noise (`Gateway error: Connection refused: Server busy`, `Error [1001]: Connection timed out`) as iOS suspended the MQTT socket. Push notifications via Web Push (VAPID) were unaffected — this only cleans up the noise from the separate real-time channel.

### Changed
- `scheduleReconnect` now bails out early when `document.hidden` — iOS/Safari won't let a background reconnect succeed, retries just produce noise. `visibilitychange → visible` still triggers an immediate reconnect.
- Gateway connection errors while backgrounded are logged at `DEBUG` instead of `ERROR`. Foreground errors still show at `ERROR` as before.
- On `visibilitychange → visible` with a stale/failed connection, the reconnect-attempt counter resets so users don't wait through exponential backoff from failed background retries.
