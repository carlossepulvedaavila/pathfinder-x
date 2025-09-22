// Background service worker for Pathfinder-X
// Handles communication between content script and popup

let popupPort = null;

// Handle connections from popup
chrome.runtime.onConnect.addListener((port) => {
  console.log("Background: Port connection attempt:", port.name);
  if (port.name === "popup") {
    popupPort = port;
    console.log("Background: Popup connected");
    port.onDisconnect.addListener(() => {
      console.log("Background: Popup disconnected");
      popupPort = null;
    });
  }
});

// Handle messages from content script and forward to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (message.type === "XPATH_FOUND" || message.type === "XPATH_CLEAR") {
    console.log("Background: Processing", message.type, "message");

    // Forward to popup if it's connected
    if (popupPort) {
      console.log("Background: Forwarding message to popup via port");
      try {
        popupPort.postMessage(message);
        console.log("Background: Successfully sent via port");
      } catch (error) {
        console.log("Background: Port message failed:", error);
      }
    } else {
      console.log("Background: No popup connected, storing message");
    }

    // Also try direct message to popup as fallback
    try {
      chrome.runtime.sendMessage(message);
      console.log("Background: Sent direct message to popup");
    } catch (error) {
      console.log("Background: Direct message failed:", error);
    }

    // Store the message for when popup opens
    chrome.storage.local.set({ lastMessage: message }, () => {
      console.log("Background: Stored message in local storage");
    });
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
    // Open the popup or inject content script
    chrome.action.openPopup();
  }
});
