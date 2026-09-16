# RiviumPush Web SDK

Real-time push notifications for browsers. No Firebase dependency.

## Features

- Real-time push notifications via WebSocket
- Web Push (VAPID) for background notifications when browser is closed
- Rich notifications (images, action buttons, badges, deep links)
- Topic subscriptions
- Auto-reconnection with exponential backoff
- Network and visibility state monitoring
- Badge management (Badge API + favicon fallback)
- Localization support
- Analytics tracking
- TypeScript support
- Works with any framework (React, Vue, Angular, vanilla JS)

## Installation

### NPM

```bash
npm install @rivium/push-web
```

### CDN (UMD)

```html
<script src="https://unpkg.com/@rivium/push-web/dist/index.umd.js"></script>
```

### CDN (ES Module)

```html
<script type="module">
  import RiviumPush from 'https://unpkg.com/@rivium/push-web/dist/index.esm.js';
</script>
```

## Service Worker Setup

Copy the service worker file to your public directory:

```bash
# NPM
cp node_modules/@rivium/push-web/service-worker.js public/rivium-push-sw.js

# CDN
curl -o public/rivium-push-sw.js https://unpkg.com/@rivium/push-web/service-worker.js
```

## Quick Start

```typescript
import RiviumPush from '@rivium/push-web';

// Initialize
const riviumPush = new RiviumPush({
  apiKey: 'rv_live_your_api_key',  // Get from Rivium Console
});

// Set up callbacks
riviumPush.onMessage((message) => {
  console.log('Title:', message.title);
  console.log('Body:', message.body);
  console.log('Data:', message.data);
});

riviumPush.onConnectionState((state) => {
  console.log('Connection:', state); // 'connected' | 'disconnected' | 'connecting'
});

riviumPush.onRegistered((deviceId) => {
  console.log('Device ID:', deviceId);
});

// Register device (requests notification permission automatically)
const deviceId = await riviumPush.register({ userId: 'user_123' });
```

## Configuration

```typescript
const riviumPush = new RiviumPush({
  apiKey: 'rv_live_...',                    // Required - from Rivium Console
  serviceWorkerPath: '/rivium-push-sw.js',  // Optional - service worker path
  autoRegisterServiceWorker: true,          // Optional - auto register SW (default: true)
  mqttQos: 1,                              // Optional - MQTT QoS level (default: 1)
  maxReconnectAttempts: 10,                 // Optional - max reconnect attempts (default: 10)
  logLevel: RiviumPushLogLevel.ERROR,       // Optional - log level
  appVersion: '2.0.0',                      // Optional - your app version (segment filter)
  autoRefresh: true,                        // Optional - background re-registration (default: true)
});
```

### Automatic refresh

With `autoRefresh` on (the default), a browser that has registered before is
silently re-registered on page load when its registration is likely stale: 24
hours have passed, the push subscription endpoint changed, or `appVersion`, the
SDK version or the user ID changed. It never shows a permission prompt (it only
runs when permission is already granted) and never throws. Calling `register()`
yourself still always registers.

### SDK version

```typescript
import { SDK_VERSION } from '@rivium/push-web';
console.log(SDK_VERSION); // "0.1.5"
```

The SDK reports `sdkName` / `sdkVersion`, the OS and the browser (as
`osVersion` / `deviceModel`) when registering, so they show up in the dashboard.

## Callbacks

All event handlers return an unsubscribe function.

```typescript
// Receive messages (foreground)
const unsub = riviumPush.onMessage((message) => {
  console.log(message.title, message.body);
});

// Connection state
riviumPush.onConnectionState((state) => {
  // 'connecting' | 'connected' | 'disconnected' | 'error'
});

// Registration complete
riviumPush.onRegistered((deviceId) => {});

// Background notification click
riviumPush.onNotificationClick((message, action) => {
  if (message.deepLink) {
    window.location.href = message.deepLink;
  }
});

// Action button click
riviumPush.onActionClicked((actionId, message) => {
  console.log('Action:', actionId);
});

// Errors
riviumPush.onError((error) => {});
riviumPush.onDetailedError((error) => {
  console.log('Code:', error.code, 'Message:', error.message);
});

// Reconnection
riviumPush.onReconnecting((state) => {
  console.log('Attempt:', state.retryAttempt, 'Next in:', state.nextRetryMs, 'ms');
});

// Network state
riviumPush.onNetworkState((state) => {
  console.log('Online:', state.isAvailable, 'Type:', state.networkType);
});

// App visibility
riviumPush.onAppState((state) => {
  console.log('Visible:', state.isVisible);
});

// Clean up
unsub();
```

## Topics

```typescript
await riviumPush.subscribeTopic('news');
await riviumPush.subscribeTopic('promotions');
await riviumPush.unsubscribeTopic('promotions');
```

## User Management

```typescript
// Set user ID after login
await riviumPush.setUserId('user_123');

// Clear user ID on logout
riviumPush.clearUserId();

// Register with user ID
await riviumPush.register({ userId: 'user_123' });
```

## Badge Management

```typescript
riviumPush.setBadgeCount(5);
riviumPush.clearBadge();
const count = riviumPush.getBadgeCount();
```

## Analytics

```typescript
riviumPush.setAnalyticsHandler((event, properties) => {
  // Send to your analytics service
  analytics.track(`rivium_push_${event}`, properties);
});

riviumPush.disableAnalytics();
```

## Log Levels

```typescript
import { RiviumPushLogLevel } from '@rivium/push-web';

riviumPush.setLogLevel(RiviumPushLogLevel.DEBUG);   // Development
riviumPush.setLogLevel(RiviumPushLogLevel.ERROR);   // Production

// Available: NONE, ERROR, WARNING, INFO, DEBUG, VERBOSE
```

## Utilities

```typescript
const connected = riviumPush.isConnected();
const deviceId = riviumPush.getDeviceId();
const network = riviumPush.getNetworkState();
const appState = riviumPush.getAppState();
const initialMessage = riviumPush.getInitialMessage();

// Static methods
RiviumPush.isSupported();
RiviumPush.getPermissionStatus();

// Unregister
await riviumPush.unregister();
```

## CDN Usage (HTML)

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <script src="https://unpkg.com/@rivium/push-web/dist/index.umd.js"></script>
  <script>
    const riviumPush = new RiviumPushWeb.default({
      apiKey: 'rv_live_your_api_key',
    });

    riviumPush.onMessage(function(message) {
      console.log('Received:', message.title);
    });

    riviumPush.onConnectionState(function(state) {
      console.log('Connection:', state);
    });

    riviumPush.register().then(function(deviceId) {
      console.log('Registered:', deviceId);
    });
  </script>
</body>
</html>
```

## Message Inbox

Inbox messages are stored server-side and stay available until the user reads,
archives or deletes them. `riviumPush.inbox` needs a registered device.

```typescript
// Live updates (an inbox message never shows a notification)
riviumPush.inbox.onMessage((message) => console.log(message.content.title));
riviumPush.inbox.onUnreadCountChange((count) => setBadge(count));

// Read
const { messages, total, unreadCount } = await riviumPush.inbox.getMessages({
  status: 'unread',
  limit: 20,
});
const cached = riviumPush.inbox.getCachedMessages(); // instant, no network

// Write
await riviumPush.inbox.markAsRead(messages[0].id);
await riviumPush.inbox.archiveMessage(messages[0].id);
await riviumPush.inbox.deleteMessage(messages[0].id);
await riviumPush.inbox.markMultiple(['id-1', 'id-2'], 'read');
await riviumPush.inbox.markAllAsRead();
```

Messages are cached per device and restored on the next page load. The cache is
dropped when the user changes (`setUserId` / `clearUserId`).

## In-App Messages

In-app messages are campaigns shown inside your page — a modal, banner,
fullscreen takeover or card — when a trigger fires. `riviumPush.inApp` needs a
registered device.

```typescript
const riviumPush = new RiviumPush({
  apiKey: 'rv_live_your_api_key',
  inApp: {
    display: 'auto',        // 'manual' to render your own UI
    autoTrigger: false,     // true fires session-start + app-open on page load
    bannerPosition: 'top',
  },
});

riviumPush.inApp.onMessageReady((message) => console.log(message.name));
riviumPush.inApp.onButtonClicked((message, button) => {
  if (button.action === 'custom') doSomething(button.value);
});
riviumPush.inApp.onDismissed((message) => console.log('closed', message.id));

await riviumPush.inApp.triggerOnAppOpen();
await riviumPush.inApp.triggerEvent('purchase_completed', { plan: 'pro' });
```

The built-in UI renders into a **shadow DOM** root, so your page's CSS can never
break it and the SDK's CSS never leaks into your page. Modals and fullscreen
messages are dialogs (`role="dialog"`, `aria-modal`, focus trap, focus restored
on close, dismissible with Escape or a backdrop click); banners and cards are
polite live regions. Reduced-motion preferences are respected.

With `display: 'manual'` nothing is inserted into the page: you get
`onMessageReady` and render the message yourself, then call
`riviumPush.inApp.recordImpression(id, 'button_click', buttonId)` and
`riviumPush.inApp.dismissCurrentMessage()` as the user interacts.

Eligible messages are cached per device for 5 minutes, and impression counts,
schedules and `minSessionCount` are enforced locally as well as on the server.
The cache is dropped when the user changes (`setUserId` / `clearUserId`).

## Delivery Tracking

Notifications are confirmed as `delivered` automatically: Web Push arrivals by
the service worker, and messages received over the real-time connection on an
open page by the SDK. No code needed.

## Browser Support

- Chrome 50+ (Desktop & Android)
- Firefox 44+
- Edge 17+
- Safari 16+ (macOS only, iOS does not support Web Push)
- Opera 37+

## Requirements

- HTTPS required (localhost works for development)
- Service worker file must be in the public root directory

## Example

See the [web_example](web_example/) directory for a complete interactive demo with all features.

The Push SDK works independently without VoIP.

## Links

- [Rivium Push](https://rivium.co/cloud/rivium-push) - Learn more about Rivium Push
- [Documentation](https://rivium.co/cloud/rivium-push/docs/quick-start) - Full documentation and guides
- [Rivium Console](https://console.rivium.co) - Manage your push notifications

## License

MIT License - see [LICENSE](LICENSE) for details.
