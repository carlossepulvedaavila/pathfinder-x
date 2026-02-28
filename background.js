// Background service worker for Pathfinder-X
// Handles communication between content script and side panel

// Open side panel automatically when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Keyboard shortcut to toggle inspection mode
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-inspect") {
    chrome.runtime.sendMessage({ type: "TOGGLE_INSPECT" }).catch(() => {
      // Panel not open — ignore
    });
  }
});

// Detect side panel close via port disconnect and clean up content script state
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;

  port.onDisconnect.addListener(() => {
    function sendPanelClosed(tabId) {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        if (chrome.runtime.lastError || !frames) return;

        frames.forEach((frame) => {
          chrome.tabs.sendMessage(
            tabId,
            { type: "PANEL_CLOSED" },
            { frameId: frame.frameId },
            () => void chrome.runtime.lastError
          );
        });
      });
    }

    // Broadcast PANEL_CLOSED to ALL tabs so every content script
    // can clean up its visual state (highlights, hover listeners).
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      for (const tab of tabs) {
        if (tab.id) sendPanelClosed(tab.id);
      }
    });
  });
});

// Handle messages from content script and forward to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Unknown sender" });
    return false;
  }

  if (message.type === "LOCK_STATE_SYNC") {
    const tabId = sender?.tab?.id;

    if (typeof tabId !== "number") {
      sendResponse({ success: false, error: "Missing tabId" });
      return false;
    }

    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }

      frames.forEach((frame) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: "LOCK_STATE_SYNC", locked: message.locked },
          { frameId: frame.frameId },
          () => {
            // Suppress errors for frames that don't have the content script
            void chrome.runtime.lastError;
          }
        );
      });

      sendResponse({ success: true });
    });

    return true; // Keep channel open for async sendResponse
  }

  if (
    message.type === "XPATH_FOUND" ||
    message.type === "XPATH_CLEAR" ||
    message.type === "XPATH_LOCKED" ||
    message.type === "XPATH_UNLOCKED"
  ) {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ success: false, error: "Missing tabId" });
      return false;
    }

    const enrichedMessage = {
      ...message,
      context: {
        ...(message.context || {}),
        frame: {
          ...(message.context?.frame || {}),
          frameId: sender?.frameId,
          tabId,
          url: message.context?.frame?.url || sender?.url || "",
        },
      },
    };

    const storageKey = `tabState_${tabId}`;

    // Only persist states that should survive tab switches
    if (message.type === "XPATH_FOUND" || message.type === "XPATH_LOCKED") {
      chrome.storage.local.set({ [storageKey]: enrichedMessage }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false });
          return;
        }
        sendResponse({ success: true });
      });
    } else {
      // XPATH_CLEAR / XPATH_UNLOCKED — remove stale stored state
      chrome.storage.local.remove(storageKey, () => {
        void chrome.runtime.lastError;
        sendResponse({ success: true });
      });
    }

    // Forward to side panel if it's open
    try {
      chrome.runtime.sendMessage(enrichedMessage).catch(() => {
        // Side panel might not be open
      });
    } catch (error) {
      // Side panel not available
    }

    return true; // Keep channel open for async storage callback
  }

  return false;
});

// Clean up tab state when tabs are closed (runs even when panel is closed)
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`tabState_${tabId}`);
});

// Context menu item for easier access
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "pathfinder-xpath",
    title: "Get XPath",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "pathfinder-xpath") {
    chrome.sidePanel.open({ tabId: tab.id });
    chrome.tabs.sendMessage(
      tab.id,
      { type: "CONTEXT_MENU_XPATH" },
      { frameId: info.frameId },
      () => void chrome.runtime.lastError
    );
  }
});
