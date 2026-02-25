// Background service worker for Pathfinder-X
// Handles communication between content script and side panel

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior — open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

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
    const enrichedMessage = {
      ...message,
      context: {
        ...(message.context || {}),
        frame: {
          ...(message.context?.frame || {}),
          frameId: sender?.frameId,
          tabId: sender?.tab?.id,
          url: message.context?.frame?.url || sender?.url || "",
        },
      },
    };

    // Store per-tab so each tab's locked state is independent
    const tabId = sender?.tab?.id;
    const storageKey = tabId ? `tabState_${tabId}` : "tabState_unknown";
    chrome.storage.local.set({ [storageKey]: enrichedMessage }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false });
        return;
      }
      sendResponse({ success: true });
    });

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
  }
});
