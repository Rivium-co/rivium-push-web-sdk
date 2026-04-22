/**
 * RiviumPush Service Worker
 * Handles background push notifications and notification actions
 * Version: 2.2.0 - Force notification display with unique tags
 */

// Cache name for offline assets
const CACHE_NAME = 'rivium-push-v2.2';

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[RiviumPush SW] Installing...');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[RiviumPush SW] Activating...');
  event.waitUntil(self.clients.claim());
});

// Push event - handle incoming push notifications (Web Push API)
// This fires when browser receives a push from the server, even when tab is closed
self.addEventListener('push', (event) => {
  console.log('[RiviumPush SW] ========== PUSH EVENT RECEIVED ==========');
  console.log('[RiviumPush SW] Event:', event);
  console.log('[RiviumPush SW] Has data:', !!event.data);

  // Default notification data
  let data = {
    title: 'New Notification',
    body: '',
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      console.log('[RiviumPush SW] Push payload (JSON):', JSON.stringify(payload, null, 2));
      data = { ...data, ...payload };
    } catch (e) {
      const textData = event.data.text();
      console.log('[RiviumPush SW] Push data is text:', textData);
      data.body = textData;
    }
  } else {
    console.log('[RiviumPush SW] Push event has no data, showing default notification');
  }

  const title = data.title || 'New Notification';

  // Generate unique tag to prevent notification collapsing/replacement
  const uniqueTag = `rivium-push-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const options = {
    body: data.body || '',
    icon: data.iconUrl || data.icon || '/favicon.ico',
    badge: data.iconUrl || data.icon || '/favicon.ico',
    image: data.imageUrl || data.image,
    tag: uniqueTag, // Unique tag ensures each notification is shown separately
    data: {
      ...data.data,
      deepLink: data.deepLink,
      messageId: data.messageId,
      campaignId: data.campaignId,
      riviumPushMessage: data,
    },
    requireInteraction: true, // Always require user interaction to dismiss
    silent: data.silent === true || data.sound === 'none',
    renotify: true, // Force notification even if same tag exists
    actions: [],
  };

  console.log('[RiviumPush SW] Notification options:', JSON.stringify({
    tag: options.tag,
    requireInteraction: options.requireInteraction,
    silent: options.silent,
    renotify: options.renotify,
  }));

  // Add action buttons if provided (max 2 in most browsers)
  if (data.actions && Array.isArray(data.actions)) {
    options.actions = data.actions.slice(0, 2).map((action) => ({
      action: action.id,
      title: action.title,
      icon: action.icon,
    }));
    console.log('[RiviumPush SW] Actions added:', JSON.stringify(options.actions));
  } else {
    console.log('[RiviumPush SW] No actions in payload');
  }

  // Always show notification first, then forward to clients
  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => {
        console.log('[RiviumPush SW] Notification shown successfully');

        // Also forward to any open clients for in-app handling
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then((clientList) => {
        if (clientList && clientList.length > 0) {
          console.log('[RiviumPush SW] Forwarding to', clientList.length, 'client(s)');
          clientList.forEach(client => {
            client.postMessage({
              type: 'push-message',
              message: data,
            });
          });
        }
      })
      .catch((err) => console.error('[RiviumPush SW] Failed to show notification:', err))
  );
});

// Notification click event - handle notification and action clicks
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const notification = event.notification;
  const data = notification.data || {};
  const riviumPushMessage = data.riviumPushMessage || {};

  console.log('[RiviumPush SW] ========== NOTIFICATION CLICK ==========');
  console.log('[RiviumPush SW] Action:', action || '(none - main body click)');
  console.log('[RiviumPush SW] Data:', JSON.stringify(data));

  notification.close();

  // Determine URL to open
  let urlToOpen = null;

  if (action && riviumPushMessage.actions) {
    // Action button was clicked - find the action's URL
    const clickedAction = riviumPushMessage.actions.find((a) => a.id === action);
    if (clickedAction?.action) {
      urlToOpen = clickedAction.action;
    }
  } else if (data.deepLink || riviumPushMessage.deepLink) {
    // Notification body clicked - use deepLink if available
    urlToOpen = data.deepLink || riviumPushMessage.deepLink;
  } else if (riviumPushMessage.actions && riviumPushMessage.actions.length > 0) {
    // No deepLink but has actions - use the first action's URL as fallback
    const firstAction = riviumPushMessage.actions[0];
    if (firstAction?.action) {
      urlToOpen = firstAction.action;
      console.log('[RiviumPush SW] Using first action URL as fallback:', urlToOpen);
    }
  }

  console.log('[RiviumPush SW] URL to open:', urlToOpen || '(none)');

  // Always open a window - either existing or new
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        console.log('[RiviumPush SW] Found clients:', clientList.length);

        // If there's a URL to navigate to, just open it directly
        if (urlToOpen) {
          console.log('[RiviumPush SW] Opening URL directly:', urlToOpen);
          return clients.openWindow(urlToOpen);
        }

        // Otherwise, focus existing window or open root
        if (clientList.length > 0) {
          const client = clientList[0];
          console.log('[RiviumPush SW] Focusing existing client');

          return client.focus().then((focusedClient) => {
            // Send click event to the app
            focusedClient.postMessage({
              type: action ? 'action-clicked' : 'notification-click',
              actionId: action,
              message: riviumPushMessage,
            });
            console.log('[RiviumPush SW] Message sent to client');
          });
        }

        // No clients, open root
        console.log('[RiviumPush SW] No clients, opening /');
        return clients.openWindow('/');
      })
      .catch((err) => {
        console.error('[RiviumPush SW] Error handling click:', err);
      })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('[RiviumPush SW] Notification closed');
});

// Message event - handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[RiviumPush SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
