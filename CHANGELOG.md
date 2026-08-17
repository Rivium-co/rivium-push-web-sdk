# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-17

### Fixed
- iOS Safari PWA backgrounding produced console noise (`Gateway error: Connection refused: Server busy`, `Error [1001]: Connection timed out`) as iOS suspended the MQTT socket. Push notifications via Web Push (VAPID) were unaffected — this only cleans up the noise from the separate real-time channel.

### Changed
- `scheduleReconnect` now bails out early when `document.hidden` — iOS/Safari won't let a background reconnect succeed, retries just produce noise. `visibilitychange → visible` still triggers an immediate reconnect.
- Gateway connection errors while backgrounded are logged at `DEBUG` instead of `ERROR`. Foreground errors still show at `ERROR` as before.
- On `visibilitychange → visible` with a stale/failed connection, the reconnect-attempt counter resets so users don't wait through exponential backoff from failed background retries.
