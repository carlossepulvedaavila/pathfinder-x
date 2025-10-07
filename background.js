// Background service worker for Pathfinder-X
// Handles communication between content script and popup

// Handle messages from content script and forward to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (message.type === "LOCK_STATE_SYNC") {
    const tabId = sender?.tab?.id;

    if (typeof tabId !== "number") {
      sendResponse({ success: false, error: "Missing tabId" });
      return false;
    }

    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError) {
        console.log(
          "Background: Failed to enumerate frames for lock sync:",
          chrome.runtime.lastError
        );
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      frames.forEach((frame) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: "LOCK_STATE_SYNC", locked: message.locked },
          { frameId: frame.frameId },
          () => {
            if (chrome.runtime.lastError) {
              console.log(
                `Background: Failed to sync lock state to frame ${frame.frameId}:`,
                chrome.runtime.lastError
              );
            }
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
    message.type === "XPATH_UNLOCKED" ||
    message.type === "XPATH_SELECTED"
  ) {
    console.log("Background: Processing", message.type, "message");

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

    // Store the message for when popup opens
    chrome.storage.local.set({ lastMessage: enrichedMessage }, () => {
      console.log("Background: Stored message in local storage");
      sendResponse({ success: true });
    });

    // Try to send message to popup if it's open
    try {
      chrome.runtime
        .sendMessage(enrichedMessage)
        .catch(() => {
          // Popup might not be open, which is fine
          console.log("Background: Popup not open, message stored for later");
        });
    } catch (error) {
      console.log("Background: Error sending to popup:", error);
    }
  }

  return true; // Keep message channel open for async response
});

// Optional: Add context menu item for easier access
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "pathfinder-xpath",
    title: "Get XPath",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "pathfinder-xpath") {
    chrome.action.openPopup();
  }
});
