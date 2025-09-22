// Background service worker for Pathfinder-X
// Handles communication between content script and popup

// Handle messages from content script and forward to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (
    message.type === "XPATH_FOUND" ||
    message.type === "XPATH_CLEAR" ||
    message.type === "XPATH_LOCKED" ||
    message.type === "XPATH_UNLOCKED" ||
    message.type === "XPATH_SELECTED"
  ) {
    console.log("Background: Processing", message.type, "message");

    // Store the message for when popup opens
    chrome.storage.local.set({ lastMessage: message }, () => {
      console.log("Background: Stored message in local storage");
      sendResponse({ success: true });
    });

    // Try to send message to popup if it's open
    try {
      chrome.runtime.sendMessage(message).catch(() => {
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
    // Open the popup or inject content script
    chrome.action.openPopup();
  }
});
