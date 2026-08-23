# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
