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
});
```

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
