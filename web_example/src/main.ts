import RiviumPush, {
  RiviumPushLogLevel,
  RiviumPushAnalyticsEvent,
  RiviumPushMessage,
  RiviumPushError,
  ConnectionState,
  NetworkState,
  ReconnectionState,
} from '@rivium/push-web';

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Status
  connectionStatus: document.getElementById('connection-status')!,
  deviceId: document.getElementById('device-id')!,
  networkStatus: document.getElementById('network-status')!,
  permissionStatus: document.getElementById('permission-status')!,

  // Config inputs
  apiKey: document.getElementById('input-api-key') as HTMLInputElement,
  serverUrl: document.getElementById('input-server-url') as HTMLInputElement,
  userId: document.getElementById('input-user-id') as HTMLInputElement,
  logLevel: document.getElementById('select-log-level') as HTMLSelectElement,
  analyticsToggle: document.getElementById('toggle-analytics') as HTMLInputElement,

  // Buttons
  btnRegister: document.getElementById('btn-register') as HTMLButtonElement,
  btnUnregister: document.getElementById('btn-unregister') as HTMLButtonElement,

  // Topics
  topicInput: document.getElementById('input-topic') as HTMLInputElement,
  btnSubscribe: document.getElementById('btn-subscribe') as HTMLButtonElement,
  btnUnsubscribe: document.getElementById('btn-unsubscribe') as HTMLButtonElement,
  subscribedTopics: document.getElementById('subscribed-topics')!,

  // Badge
  badgeCount: document.getElementById('badge-count')!,
  btnBadgeIncrement: document.getElementById('btn-badge-increment') as HTMLButtonElement,
  btnBadgeDecrement: document.getElementById('btn-badge-decrement') as HTMLButtonElement,
  btnBadgeSet: document.getElementById('btn-badge-set') as HTMLButtonElement,
  btnBadgeClear: document.getElementById('btn-badge-clear') as HTMLButtonElement,

  // Messages
  messagesContainer: document.getElementById('messages-container')!,

  // Log
  logContainer: document.getElementById('log-container')!,
  btnClearLog: document.getElementById('btn-clear-log') as HTMLButtonElement,
};

// ============================================================================
// State
// ============================================================================

let riviumPush: RiviumPush | null = null;
const subscribedTopics: Set<string> = new Set();
const receivedMessages: RiviumPushMessage[] = [];

// ============================================================================
// Logging
// ============================================================================

type LogLevel = 'info' | 'success' | 'warning' | 'error';

function log(message: string, level: LogLevel = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-${level}">${escapeHtml(message)}</span>`;
  elements.logContainer.appendChild(entry);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// UI Updates
// ============================================================================

function updateConnectionStatus(state: ConnectionState) {
  const badge = elements.connectionStatus;
  badge.className = `status-badge ${state === 'connected' ? 'connected' : 'disconnected'}`;
  badge.innerHTML = `<span class="status-dot"></span>${state.charAt(0).toUpperCase() + state.slice(1)}`;
}

function updateDeviceId(id: string | null) {
  elements.deviceId.textContent = id || '-';
}

function updateNetworkStatus(state: NetworkState) {
  elements.networkStatus.textContent = `${state.isAvailable ? 'Online' : 'Offline'} (${state.networkType})`;
}

function updatePermissionStatus() {
  const permission = RiviumPush.getPermissionStatus();
  elements.permissionStatus.textContent = permission;
  elements.permissionStatus.style.color =
    permission === 'granted' ? 'var(--success)' :
    permission === 'denied' ? 'var(--danger)' : 'var(--warning)';
}

function updateBadgeDisplay() {
  if (riviumPush) {
    elements.badgeCount.textContent = riviumPush.getBadgeCount().toString();
  }
}

function updateTopicsDisplay() {
  if (subscribedTopics.size === 0) {
    elements.subscribedTopics.innerHTML = '<div class="empty-state">No subscribed topics</div>';
  } else {
    elements.subscribedTopics.innerHTML = Array.from(subscribedTopics)
      .map(topic => `<span class="status-badge connected" style="margin: 0.25rem;">${escapeHtml(topic)}</span>`)
      .join('');
  }
}

function addMessageToUI(message: RiviumPushMessage) {
  receivedMessages.unshift(message);

  // Keep only last 20 messages
  if (receivedMessages.length > 20) {
    receivedMessages.pop();
  }

  renderMessages();

  // Show in-app toast notification when tab is visible
  showToast(message);
}

function showToast(message: RiviumPushMessage) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'rivium-push-toast';
  toast.innerHTML = `
    <div class="toast-icon">${message.iconUrl ? `<img src="${escapeHtml(message.iconUrl)}" alt="">` : '🔔'}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(message.title)}</div>
      <div class="toast-body">${escapeHtml(message.body)}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  // Add styles if not already added
  if (!document.getElementById('rivium-push-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'rivium-push-toast-styles';
    style.textContent = `
      .rivium-push-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: #1a1a2e;
        border: 1px solid #4a4a6a;
        border-radius: 12px;
        padding: 16px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        max-width: 380px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
      }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      .rivium-push-toast.hiding { animation: slideOut 0.3s ease-in forwards; }
      .toast-icon { font-size: 24px; }
      .toast-icon img { width: 40px; height: 40px; border-radius: 8px; }
      .toast-content { flex: 1; }
      .toast-title { font-weight: 600; color: #fff; margin-bottom: 4px; }
      .toast-body { color: #a0a0b0; font-size: 14px; }
      .toast-close {
        background: none;
        border: none;
        color: #666;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }
      .toast-close:hover { color: #fff; }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Close button handler
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn?.addEventListener('click', () => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  });

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

function renderMessages() {
  if (receivedMessages.length === 0) {
    elements.messagesContainer.innerHTML = '<div class="empty-state">No messages received yet</div>';
    return;
  }

  elements.messagesContainer.innerHTML = receivedMessages
    .map(msg => `
      <div class="message-card">
        <div class="message-title">${escapeHtml(msg.title)}</div>
        <div class="message-body">${escapeHtml(msg.body)}</div>
        ${msg.data ? `<div class="message-body">Data: ${escapeHtml(JSON.stringify(msg.data))}</div>` : ''}
        <div class="message-time">${new Date().toLocaleTimeString()}</div>
      </div>
    `)
    .join('');
}

function setButtonStates(registered: boolean) {
  elements.btnRegister.disabled = registered;
  elements.btnUnregister.disabled = !registered;
  elements.btnSubscribe.disabled = !registered;
  elements.btnUnsubscribe.disabled = !registered;
}

// ============================================================================
// SDK Initialization
// ============================================================================

function initializeRiviumPush() {
  const apiKey = elements.apiKey.value.trim();
  const serverUrl = elements.serverUrl.value.trim();

  if (!apiKey) {
    log('API key is required', 'error');
    return null;
  }

  if (!serverUrl) {
    log('Server URL is required', 'error');
    return null;
  }

  try {
    const instance = new RiviumPush({
      apiKey,
      serverUrl,
      logLevel: parseInt(elements.logLevel.value) as RiviumPushLogLevel,
    });

    // Set up callbacks
    instance.onMessage((message) => {
      log(`Message received: ${message.title}`, 'success');
      addMessageToUI(message);
    });

    instance.onConnectionState((state) => {
      log(`Connection state: ${state}`, state === 'connected' ? 'success' : 'warning');
      updateConnectionStatus(state);
    });

    instance.onRegistered((deviceId) => {
      log(`Registered with device ID: ${deviceId}`, 'success');
      updateDeviceId(deviceId);
      setButtonStates(true);
    });

    instance.onError((error) => {
      log(`Error: ${error.message}`, 'error');
    });

    instance.onDetailedError((error: RiviumPushError) => {
      log(`Detailed error [${error.code}]: ${error.message}${error.details ? ` - ${error.details}` : ''}`, 'error');
    });

    instance.onNotificationClick((message, action) => {
      log(`Notification clicked: ${message.title}${action ? ` (action: ${action})` : ''}`, 'info');

      // Handle deep link navigation
      if (message.deepLink) {
        log(`Navigating to: ${message.deepLink}`, 'info');
        window.location.href = message.deepLink;
      }

      // Add the message to UI so user can see what was clicked
      addMessageToUI(message);
    });

    instance.onActionClicked((actionId, message) => {
      log(`Action button clicked: ${actionId} on "${message.title}"`, 'info');

      // Find the action URL from the message
      const actionDetails = message.actions?.find(a => a.id === actionId);
      if (actionDetails?.action) {
        log(`Navigating to action URL: ${actionDetails.action}`, 'info');
        window.location.href = actionDetails.action;
      }
    });

    instance.onReconnecting((state: ReconnectionState) => {
      log(`Reconnecting... attempt ${state.retryAttempt}/${state.maxRetryAttempts}, next in ${state.nextRetryMs}ms`, 'warning');
    });

    instance.onNetworkState((state: NetworkState) => {
      log(`Network state changed: ${state.isAvailable ? 'online' : 'offline'} (${state.networkType})`, 'info');
      updateNetworkStatus(state);
    });

    instance.onAppState((state) => {
      log(`App state changed: ${state.isVisible ? 'visible' : 'hidden'}`, 'info');
    });

    // Analytics handler
    if (elements.analyticsToggle.checked) {
      instance.setAnalyticsHandler((event: RiviumPushAnalyticsEvent, properties) => {
        log(`Analytics: ${event} ${properties ? JSON.stringify(properties) : ''}`, 'info');
      });
    }

    log('RiviumPush SDK initialized', 'success');
    return instance;
  } catch (error) {
    log(`Failed to initialize: ${(error as Error).message}`, 'error');
    return null;
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

elements.btnRegister.addEventListener('click', async () => {
  // Clean up previous instance before creating new one
  if (riviumPush) {
    try {
      await riviumPush.unregister();
    } catch {
      // Ignore errors during cleanup
    }
    riviumPush = null;
  }

  riviumPush = initializeRiviumPush();
  if (!riviumPush) return;

  try {
    elements.btnRegister.disabled = true;
    elements.btnRegister.textContent = 'Registering...';

    const userId = elements.userId.value.trim() || undefined;
    const deviceId = await riviumPush.register({ userId });

    log(`Registration successful! Device ID: ${deviceId}`, 'success');
    updatePermissionStatus();
    updateNetworkStatus(riviumPush.getNetworkState());
    updateBadgeDisplay();
  } catch (error) {
    log(`Registration failed: ${(error as Error).message}`, 'error');
    elements.btnRegister.disabled = false;
  } finally {
    elements.btnRegister.textContent = 'Register Device';
  }
});

elements.btnUnregister.addEventListener('click', async () => {
  if (!riviumPush) return;

  try {
    await riviumPush.unregister();
    log('Unregistered successfully', 'success');
    updateConnectionStatus('disconnected');
    updateDeviceId(null);
    setButtonStates(false);
    subscribedTopics.clear();
    updateTopicsDisplay();
    riviumPush = null;
  } catch (error) {
    log(`Unregister failed: ${(error as Error).message}`, 'error');
  }
});

elements.btnSubscribe.addEventListener('click', async () => {
  if (!riviumPush) return;

  const topic = elements.topicInput.value.trim();
  if (!topic) {
    log('Topic name is required', 'warning');
    return;
  }

  try {
    await riviumPush.subscribeTopic(topic);
    subscribedTopics.add(topic);
    updateTopicsDisplay();
    log(`Subscribed to topic: ${topic}`, 'success');
    elements.topicInput.value = '';
  } catch (error) {
    log(`Subscribe failed: ${(error as Error).message}`, 'error');
  }
});

elements.btnUnsubscribe.addEventListener('click', async () => {
  if (!riviumPush) return;

  const topic = elements.topicInput.value.trim();
  if (!topic) {
    log('Topic name is required', 'warning');
    return;
  }

  try {
    await riviumPush.unsubscribeTopic(topic);
    subscribedTopics.delete(topic);
    updateTopicsDisplay();
    log(`Unsubscribed from topic: ${topic}`, 'success');
    elements.topicInput.value = '';
  } catch (error) {
    log(`Unsubscribe failed: ${(error as Error).message}`, 'error');
  }
});

// Badge handlers
elements.btnBadgeIncrement.addEventListener('click', () => {
  if (riviumPush) {
    riviumPush.setBadgeCount(riviumPush.getBadgeCount() + 1);
    updateBadgeDisplay();
    log('Badge incremented', 'info');
  }
});

elements.btnBadgeDecrement.addEventListener('click', () => {
  if (riviumPush) {
    const current = riviumPush.getBadgeCount();
    riviumPush.setBadgeCount(Math.max(0, current - 1));
    updateBadgeDisplay();
    log('Badge decremented', 'info');
  }
});

elements.btnBadgeSet.addEventListener('click', () => {
  if (riviumPush) {
    riviumPush.setBadgeCount(5);
    updateBadgeDisplay();
    log('Badge set to 5', 'info');
  }
});

elements.btnBadgeClear.addEventListener('click', () => {
  if (riviumPush) {
    riviumPush.clearBadge();
    updateBadgeDisplay();
    log('Badge cleared', 'info');
  }
});

// Log level change
elements.logLevel.addEventListener('change', () => {
  if (riviumPush) {
    const level = parseInt(elements.logLevel.value) as RiviumPushLogLevel;
    riviumPush.setLogLevel(level);
    log(`Log level changed to: ${RiviumPushLogLevel[level]}`, 'info');
  }
});

// Analytics toggle
elements.analyticsToggle.addEventListener('change', () => {
  if (riviumPush) {
    if (elements.analyticsToggle.checked) {
      riviumPush.setAnalyticsHandler((event, properties) => {
        log(`Analytics: ${event} ${properties ? JSON.stringify(properties) : ''}`, 'info');
      });
      log('Analytics enabled', 'info');
    } else {
      riviumPush.disableAnalytics();
      log('Analytics disabled', 'info');
    }
  }
});

// Clear log
elements.btnClearLog.addEventListener('click', () => {
  elements.logContainer.innerHTML = '';
  log('Log cleared', 'info');
});

// ============================================================================
// Initialization
// ============================================================================

// Check browser support
if (!RiviumPush.isSupported()) {
  log('Push notifications are not supported in this browser', 'error');
  elements.btnRegister.disabled = true;
} else {
  log('Browser supports push notifications', 'success');
}

// Update permission status
updatePermissionStatus();

// Load saved config from localStorage
const savedApiKey = localStorage.getItem('rivium_push_demo_api_key');
const savedServerUrl = localStorage.getItem('rivium_push_demo_server_url');
const savedUserId = localStorage.getItem('rivium_push_demo_user_id');

if (savedApiKey) elements.apiKey.value = savedApiKey;
if (savedServerUrl) elements.serverUrl.value = savedServerUrl;
if (savedUserId) elements.userId.value = savedUserId;

// Save config on change
elements.apiKey.addEventListener('blur', () => {
  localStorage.setItem('rivium_push_demo_api_key', elements.apiKey.value);
});
elements.serverUrl.addEventListener('blur', () => {
  localStorage.setItem('rivium_push_demo_server_url', elements.serverUrl.value);
});
elements.userId.addEventListener('blur', () => {
  localStorage.setItem('rivium_push_demo_user_id', elements.userId.value);
});

// Auto-register if previously registered and have saved config
const savedDeviceId = localStorage.getItem('rivium_push_device_id');
const hasNotificationPermission = Notification.permission === 'granted';

if (savedApiKey && savedServerUrl && savedDeviceId && hasNotificationPermission) {
  log('Previously registered device found. Auto-registering...', 'info');

  // Auto-register on page load
  (async () => {
    riviumPush = initializeRiviumPush();
    if (!riviumPush) return;

    try {
      elements.btnRegister.disabled = true;
      elements.btnRegister.textContent = 'Auto-registering...';

      const userId = elements.userId.value.trim() || undefined;
      const deviceId = await riviumPush.register({ userId });

      log(`Auto-registration successful! Device ID: ${deviceId}`, 'success');
      updatePermissionStatus();
      updateNetworkStatus(riviumPush.getNetworkState());
      updateBadgeDisplay();
    } catch (error) {
      log(`Auto-registration failed: ${(error as Error).message}`, 'error');
      elements.btnRegister.disabled = false;
    } finally {
      elements.btnRegister.textContent = 'Register Device';
    }
  })();
} else {
  log('Ready. Enter your API key and click Register to start.', 'info');
}
