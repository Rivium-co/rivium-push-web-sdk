# Pushino Web SDK Example

A comprehensive example app demonstrating all features of the Pushino Web SDK for browser push notifications.

## Features Demonstrated

This example showcases all SDK capabilities:

### 1. Push Notifications
- Device registration with user ID
- Real-time MQTT-based message delivery
- Background notifications via Web Push API
- Notification actions handling
- Deep linking support

### 2. Topic Subscriptions
- Subscribe to custom topics
- Unsubscribe from topics
- Topic-based message targeting

### 3. Connection Management
- Real-time connection status
- Automatic reconnection with exponential backoff
- Network state monitoring
- App visibility state tracking

### 4. Badge Management
- Set, increment, decrement badge count
- Clear badge
- Favicon badge updates
- Browser Badge API support (where available)

### 5. Analytics
- SDK event tracking
- Custom analytics handler
- Enable/disable analytics

### 6. Logging
- Configurable log levels
- Real-time event log display

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A modern browser with Push API support (Chrome, Firefox, Edge, Safari 16+)
- A Pushino API key from the NextLeap Console

### Setup

1. **Navigate to the example directory**
   ```bash
   cd /path/to/pushino_project/examples/web_example
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open in browser**

   The app will open at `http://localhost:3000`

5. **Configure and register**
   - Enter your Pushino API key
   - Set the server URL (default: `https://api.pushino.io`)
   - Optionally set a user ID
   - Click "Register Device"

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
web_example/
├── index.html              # Main HTML file with UI
├── src/
│   └── main.ts            # TypeScript entry point with SDK integration
├── public/
│   └── pushino-sw.js      # Service worker for background notifications
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## SDK Integration Guide

### Initialization

```typescript
import Pushino, { PushinoLogLevel } from '@pushino/web-sdk';

const pushino = new Pushino({
  apiKey: 'nl_live_your_api_key',
  serverUrl: 'https://api.pushino.io',
  logLevel: PushinoLogLevel.DEBUG,
});
```

### Device Registration

```typescript
// Register device
const deviceId = await pushino.register({
  userId: 'user_123',  // Optional: for targeted notifications
});

console.log('Registered:', deviceId);
```

### Message Handling

```typescript
// Listen for messages
pushino.onMessage((message) => {
  console.log('Received:', message.title, message.body);
  console.log('Data:', message.data);
});

// Handle notification clicks
pushino.onNotificationClick((message, action) => {
  console.log('Clicked:', message.title);
  if (action) {
    console.log('Action:', action);
  }
});
```

### Topics

```typescript
// Subscribe to a topic
await pushino.subscribeTopic('news');

// Unsubscribe from a topic
await pushino.unsubscribeTopic('promotions');
```

### Connection Monitoring

```typescript
pushino.onConnectionState((state) => {
  console.log('Connection:', state); // 'connecting', 'connected', 'disconnected', 'error'
});

pushino.onReconnecting((state) => {
  console.log(`Retry ${state.retryAttempt}/${state.maxRetryAttempts}`);
  console.log(`Next retry in ${state.nextRetryMs}ms`);
});
```

### Network & App State

```typescript
// Get current network state
const network = pushino.getNetworkState();
console.log('Online:', network.isAvailable);
console.log('Type:', network.networkType);

// Listen for network changes
pushino.onNetworkState((state) => {
  console.log('Network changed:', state);
});

// Get app visibility state
const app = pushino.getAppState();
console.log('Visible:', app.isVisible);

// Listen for visibility changes
pushino.onAppState((state) => {
  console.log('Visibility:', state.visibilityState);
});
```

### Badge Management

```typescript
// Set badge count
pushino.setBadgeCount(5);

// Get current badge
const count = pushino.getBadgeCount();

// Clear badge
pushino.clearBadge();
```

### Analytics

```typescript
// Enable analytics with custom handler
pushino.setAnalyticsHandler((event, properties) => {
  // Send to your analytics service
  analytics.track(`pushino_${event}`, properties);
});

// Disable analytics
pushino.disableAnalytics();

// Check if enabled
const enabled = pushino.isAnalyticsEnabled();
```

### Error Handling

```typescript
pushino.onError((error) => {
  console.error('Error:', error.message);
});

pushino.onDetailedError((error) => {
  console.error('Code:', error.code);
  console.error('Message:', error.message);
  console.error('Details:', error.details);
});
```

### Logging

```typescript
import { PushinoLogLevel } from '@pushino/web-sdk';

// Set log level
pushino.setLogLevel(PushinoLogLevel.INFO);

// Available levels:
// - NONE (0): No logging
// - ERROR (1): Errors only
// - WARNING (2): Errors and warnings
// - INFO (3): Info, warnings, and errors
// - DEBUG (4): Debug and above (default)
// - VERBOSE (5): Everything
```

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 50+ | Full support |
| Firefox | 44+ | Full support |
| Edge | 17+ | Full support |
| Safari | 16+ | Web Push requires macOS Ventura+ |
| Opera | 42+ | Full support |

## Service Worker

The example includes a service worker (`public/pushino-sw.js`) that handles:
- Background push notifications
- Notification click events
- Action button clicks
- Deep linking

The service worker is automatically registered by the SDK when `autoRegisterServiceWorker` is true (default).

## HTTPS Requirement

Web Push requires HTTPS in production. For local development:
- `localhost` works without HTTPS
- Use a tool like [ngrok](https://ngrok.com) for testing on devices

## Related Documentation

- [Pushino Web SDK](../../web/pushino-web/README.md) - SDK documentation
- [NextLeap Console](https://console.nextleap.io) - Manage your projects
- [NextLeap Docs](https://docs.nextleap.io) - Full documentation

## License

Copyright (c) NextLeap. All rights reserved.
