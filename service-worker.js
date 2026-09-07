/**
 * RiviumPush Service Worker
 * Handles background push notifications with rich features
 *
 * Copy this file to your public directory as 'rivium-push-sw.js'
 */

// Cache name for offline support
const CACHE_NAME = 'rivium-push-v0.1.4';

/**
 * Config passed by the SDK on the registration URL.
 *
 * A service worker is terminated between pushes, so anything kept in memory is
 * gone by the time the next one arrives. The script URL is persisted by the
 * browser, so reading config from its query string works on every wake-up
 * without needing IndexedDB.
 */
const RIVIUM_CONFIG = (() => {
  try {
    const params = new URL(self.location.href).searchParams;
    return {
      apiKey: params.get('riviumApiKey') || null,
      serverUrl: params.get('riviumServerUrl') || 'https://push-api.rivium.co',
      deviceId: params.get('riviumDeviceId') || null,
    };
  } catch (e) {
    return { apiKey: null, serverUrl: 'https://push-api.rivium.co', deviceId: null };
  }
})();

/**
 * Confirm delivery to Rivium Push.
 *
 * Web Push, APNs and FCM all report only that the push service *accepted* a
 * notification — none of them confirm it reached the device. This ack is the
 * only signal that it actually arrived, so the dashboard can distinguish
 * "accepted" from "delivered".
 *
 * Best-effort: a failure here must never stop the notification being shown.
 */
function riviumReportDelivered(messageId) {
  if (!messageId || !RIVIUM_CONFIG.apiKey || !RIVIUM_CONFIG.deviceId) {
    return Promise.resolve();
  }

  return fetch(`${RIVIUM_CONFIG.serverUrl}/receipts/delivered`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': RIVIUM_CONFIG.apiKey,
    },
    body: JSON.stringify({
      messageId,
      deviceId: RIVIUM_CONFIG.deviceId,
    }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch((err) => {
      console.warn('[RiviumPush SW] Delivery ack failed:', err && err.message);
    });
}

// Install event
self.addEventListener('install', (event) => {
  console.log('[RiviumPush SW] Installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[RiviumPush SW] Activating...');
  event.waitUntil(self.clients.claim());
});

// Push event - received push notification
self.addEventListener('push', (event) => {
  console.log('[RiviumPush SW] Push received');

  let data = {
    title: 'New notification',
    body: '',
    icon: '/icon.png',
    badge: '/badge.png',
    data: {},
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        ...data,
        ...payload,
      };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // Get localized content if available
  const localizedTitle = getLocalizedContent(data, 'title');
  const localizedBody = getLocalizedContent(data, 'body');

  const options = {
    body: localizedBody || data.body,
    icon: data.iconUrl || data.icon,
    badge: data.iconUrl || data.icon,
    image: data.imageUrl || data.image,
    tag: data.tag || data.collapseKey || data.threadId || 'rivium-push-notification',
    data: {
      ...data.data,
      deepLink: data.deepLink,
      messageId: data.messageId,
      campaignId: data.campaignId,
      riviumPushPayload: data,
    },
    requireInteraction: true,
    silent: data.sound === 'none',
    actions: [],
  };

  // Add action buttons (max 2 for web)
  if (data.actions && Array.isArray(data.actions)) {
    options.actions = data.actions.slice(0, 2).map((action) => ({
      action: action.id,
      title: action.title,
      icon: action.icon,
    }));
  }

  // Show notification with potentially localized title
  const title = localizedTitle || data.title;

  // Show the notification and confirm delivery. Both are awaited so the
  // browser keeps the worker alive until the ack has been sent, but the ack
  // can never prevent the notification from being displayed.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      riviumReportDelivered(data.messageId),
    ])
  );
});

/**
 * The browser can rotate a push subscription at any time — after a long idle
 * period, a browser update, or when it decides the old endpoint is stale.
 * Without this handler the old endpoint stays registered server-side, keeps
 * returning 410 Gone, and the user silently stops receiving notifications.
 *
 * Re-subscribe with the same VAPID key and register the new endpoint.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[RiviumPush SW] Push subscription changed, re-subscribing');

  const applicationServerKey =
    (event.oldSubscription &&
      event.oldSubscription.options &&
      event.oldSubscription.options.applicationServerKey) ||
    null;

  if (!applicationServerKey || !RIVIUM_CONFIG.apiKey || !RIVIUM_CONFIG.deviceId) {
    console.warn(
      '[RiviumPush SW] Cannot re-subscribe: missing VAPID key or SDK config',
    );
    return;
  }

  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey })
      .then((subscription) =>
        fetch(`${RIVIUM_CONFIG.serverUrl}/devices/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': RIVIUM_CONFIG.apiKey,
          },
          body: JSON.stringify({
            deviceId: RIVIUM_CONFIG.deviceId,
            platform: 'web',
            appIdentifier: self.location.origin,
            webPushSubscription: subscription.toJSON(),
          }),
        }),
      )
      .then(() => {
        console.log('[RiviumPush SW] Re-subscribed and re-registered');
      })
      .catch((err) => {
        console.error('[RiviumPush SW] Re-subscribe failed:', err && err.message);
      }),
  );
});

// Helper function to get localized content
function getLocalizedContent(data, field) {
  if (!data.localizations || !Array.isArray(data.localizations)) {
    return null;
  }

  // Get device locale (best effort in service worker context)
  let deviceLocale = 'en';
  try {
    deviceLocale = navigator.language.split('-')[0].toLowerCase();
  } catch (e) {
    // Fallback to 'en'
  }

  const localized = data.localizations.find((loc) =>
    loc.locale.toLowerCase().startsWith(deviceLocale)
  );

  return localized ? localized[field] : null;
}

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[RiviumPush SW] Notification clicked');

  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};
  const riviumPushPayload = data.riviumPushPayload || {};

  notification.close();

  // Determine if this is an action button click
  const isActionClick = action && action !== '';

  // Find action details if action button was clicked
  let actionDetails = null;
  let targetUrl = null;

  if (isActionClick && riviumPushPayload.actions) {
    // Action button was clicked - find the action's URL
    actionDetails = riviumPushPayload.actions.find((a) => a.id === action);
    if (actionDetails && actionDetails.action) {
      targetUrl = actionDetails.action;
    }
  }

  // If no URL yet, try deepLink
  if (!targetUrl) {
    targetUrl = data.deepLink || riviumPushPayload.deepLink || data.url || data.click_action;
  }

  // If still no URL but has actions, use first action's URL as fallback
  if (!targetUrl && riviumPushPayload.actions && riviumPushPayload.actions.length > 0) {
    const firstAction = riviumPushPayload.actions[0];
    if (firstAction && firstAction.action) {
      targetUrl = firstAction.action;
      console.log('[RiviumPush SW] Using first action URL as fallback:', targetUrl);
    }
  }

  // Default to root if nothing else
  if (!targetUrl) {
    targetUrl = '/';
  }

  console.log('[RiviumPush SW] Target URL:', targetUrl);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If we have a URL to open, just open it directly
        if (targetUrl && targetUrl !== '/') {
          console.log('[RiviumPush SW] Opening URL:', targetUrl);
          return self.clients.openWindow(targetUrl);
        }

        // No external URL - check if there's already an open window to focus
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            // Send message to client
            if (isActionClick) {
              client.postMessage({
                type: 'action-clicked',
                actionId: action,
                actionDetails: actionDetails,
                message: {
                  title: notification.title,
                  body: notification.body,
                  data: data,
                  deepLink: data.deepLink,
                  messageId: data.messageId,
                  campaignId: data.campaignId,
                },
              });
            } else {
              client.postMessage({
                type: 'notification-click',
                action: action,
                message: {
                  title: notification.title,
                  body: notification.body,
                  data: data,
                  deepLink: data.deepLink,
                  messageId: data.messageId,
                  campaignId: data.campaignId,
                },
              });
            }

            return client.focus();
          }
        }

        // Open new window at root if no existing window
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('[RiviumPush SW] Notification closed');

  const notification = event.notification;
  const data = notification.data || {};

  // Send dismissal event to clients
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({
            type: 'notification-dismissed',
            message: {
              title: notification.title,
              body: notification.body,
              messageId: data.messageId,
              campaignId: data.campaignId,
            },
          });
        }
      }
    });
});

// Message from main app
self.addEventListener('message', (event) => {
  console.log('[RiviumPush SW] Message received:', event.data);

  if (event.data.type === 'skip-waiting') {
    self.skipWaiting();
  }

  if (event.data.type === 'clear-badge') {
    // Handle badge clearing if needed
  }
});

// Background sync (for offline message queue)
self.addEventListener('sync', (event) => {
  console.log('[RiviumPush SW] Sync event:', event.tag);

  if (event.tag === 'rivium-push-sync') {
    event.waitUntil(syncMessages());
  }
});

// Sync queued messages
async function syncMessages() {
  console.log('[RiviumPush SW] Syncing messages...');
  // Implement if you need to sync messages when coming back online
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'rivium-push-periodic-sync') {
    event.waitUntil(doPeriodicSync());
  }
});

async function doPeriodicSync() {
  console.log('[RiviumPush SW] Periodic sync...');
  // Implement periodic sync if needed
}
