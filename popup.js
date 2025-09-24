document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup: DOM loaded, initializing...");

  const xpathContainer = document.getElementById("xpathContainer");
  const elementInfo = document.getElementById("elementInfo");
  const elementTag = document.getElementById("elementTag");
  const elementText = document.getElementById("elementText");
  const status = document.getElementById("status");
  const clearButton = document.getElementById("clearButton");
  const lockControls = document.getElementById("lockControls");
  const unlockButton = document.getElementById("unlockButton");
  const toggle = document.getElementById("toggle");

  // Notify content script that popup is opened
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    chrome.tabs.sendMessage(tab.id, { type: "POPUP_OPENED" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(
          "Could not notify content script of popup open:",
          chrome.runtime.lastError
        );
      }
    });
  } catch (error) {
    console.log("Error notifying content script:", error);
  }

  console.log("Popup: All DOM elements found:", {
    xpathContainer: !!xpathContainer,
    elementInfo: !!elementInfo,
    elementTag: !!elementTag,
    elementText: !!elementText,
    status: !!status,
    clearButton: !!clearButton,
    lockControls: !!lockControls,
    unlockButton: !!unlockButton,
    toggle: !!toggle,
  });

  let currentXPaths = [];
  let isLocked = false;

  // 1. Immediately check local storage for the last saved XPath and toggle state
  chrome.storage.local.get(["lastMessage", "isHoveringEnabled"], (result) => {
    console.log("Popup: Retrieved from storage:", result);

    // Set toggle state
    const isHoveringEnabled = result.isHoveringEnabled !== false; // Default to true
    toggle.checked = isHoveringEnabled;
    if (isHoveringEnabled) {
      enableHover();
    } else {
      disableHover();
    }

    if (
      result.lastMessage &&
      (result.lastMessage.type === "XPATH_FOUND" ||
        result.lastMessage.type === "XPATH_LOCKED" ||
        result.lastMessage.type === "XPATH_SELECTED")
    ) {
      console.log("Popup: Found stored XPath data, displaying...");
      const locked = result.lastMessage.type === "XPATH_LOCKED";
      displayXPaths(
        result.lastMessage.xpaths,
        result.lastMessage.elementInfo,
        locked
      );

      if (locked) {
        isLocked = true;
        status.textContent = "Element Locked";
        status.className = "status active locked";
        lockControls.style.display = "flex";
      } else {
        status.textContent = "Hover over elements to get XPath";
        status.className = "status active";
      }
    } else {
      console.log("Popup: No stored XPath data found, showing placeholder");
      clearDisplay();
    }
  });

  // 2. Listen for real-time updates from background script while popup is open
  chrome.runtime.onMessage.addListener((message) => {
    console.log("Popup: Received message:", message);
    if (message.type === "XPATH_FOUND") {
      console.log("Popup: Processing XPATH_FOUND message");
      if (!isLocked) {
        // Only update if not locked
        displayXPaths(message.xpaths, message.elementInfo);
        status.textContent = "Hovering - click to select";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_SELECTED") {
      console.log("Popup: Processing XPATH_SELECTED message");
      displayXPaths(message.xpaths, message.elementInfo);
      status.textContent = "Element selected - continue hovering";
      status.className = "status active selected";
    } else if (message.type === "XPATH_LOCKED") {
      console.log("Popup: Processing XPATH_LOCKED message");
      isLocked = true;
      displayXPaths(message.xpaths, message.elementInfo, true);
      status.textContent = "Element Locked";
      status.className = "status active locked";
      lockControls.style.display = "flex";
    } else if (message.type === "XPATH_CLEAR") {
      console.log("Popup: Processing XPATH_CLEAR message");
      if (!isLocked) {
        // Only clear if not locked
        status.textContent = "Hover over elements to get XPath";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_UNLOCKED") {
      console.log("Popup: Processing XPATH_UNLOCKED message");
      isLocked = false;
      lockControls.style.display = "none";
      clearDisplay();
    }
  });

  function displayXPaths(xpaths, elementInfo, locked = false) {
    console.log("Popup: displayXPaths called with:", { xpaths, elementInfo });

    currentXPaths = xpaths;

    // Show element info
    if (elementInfo) {
      elementTag.textContent = `<${elementInfo.tagName.toLowerCase()}>`;
      elementText.textContent = elementInfo.textContent || "No text content";
      document.getElementById("elementInfo").style.display = "block";
    }

    // Clear container
    xpathContainer.innerHTML = "";

    // Create XPath options
    if (!xpaths || !Array.isArray(xpaths)) {
      console.error("Popup: Invalid XPaths data:", xpaths);
      return;
    }

    console.log("Popup: Creating XPath options for:", xpaths);

    xpaths.forEach((option, index) => {
      console.log(`Popup: Processing XPath option ${index}:`, option);

      const optionDiv = document.createElement("div");
      optionDiv.className = "xpath-option";

      const header = document.createElement("div");
      header.className = "xpath-header";

      const typeSpan = document.createElement("span");
      typeSpan.textContent = option.type;

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => copyXPath(option.xpath, copyBtn);

      header.appendChild(typeSpan);
      header.appendChild(copyBtn);

      const content = document.createElement("div");
      content.className = "xpath-content";
      content.textContent = option.xpath;

      const validation = document.createElement("div");
      validation.className = "validation";

      // Validate XPath
      validateXPath(option.xpath).then((isValid) => {
        if (isValid) {
          validation.textContent = "Valid XPath";
          validation.className = "validation valid";
        } else {
          validation.textContent = "Invalid XPath";
          validation.className = "validation invalid";
        }
      });

      optionDiv.appendChild(header);
      optionDiv.appendChild(content);
      optionDiv.appendChild(validation);

      xpathContainer.appendChild(optionDiv);
    });

    clearButton.style.display = "block";
  }

  function clearDisplay() {
    const statusStrongText = isLocked
      ? "Element is locked."
      : "Hover over any element on the webpage";

    const strongText = isLocked
      ? "Click 'Unlock' to resume hover detection."
      : " to generate XPath selectors optimized for Playwright and Selenium.";

    const placeholderHTML = ` 
       <div class="placeholder"> 
         <img 
           class="placeholder__icon" 
           src= ${
             isLocked ? "./images/locked-icon.png" : "./images/hover-icon.png"
           } 
           alt="Hover Icon" 
         /> 
         <p> 
           <strong>${statusStrongText}</strong> 
           <br /> 
           ${strongText} 
         </p> 
       </div> 
     `;

    xpathContainer.innerHTML = placeholderHTML;
    document.getElementById("elementInfo").style.display = "none";
    clearButton.style.display = "none";
    lockControls.style.display = "none";
    status.textContent = isLocked
      ? "Element Locked"
      : "Hover over elements to get XPath";
    status.className = isLocked ? "status active locked" : "status active";
    currentXPaths = [];
  }

  async function copyXPath(xpath, button) {
    try {
      await navigator.clipboard.writeText(xpath);
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.className = "copy-btn copied";

      setTimeout(() => {
        button.textContent = originalText;
        button.className = "copy-btn";
      }, 1500);
    } catch (err) {
      console.error("Failed to copy XPath:", err);
      button.textContent = "Error";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1500);
    }
  }

  async function validateXPath(xpath) {
    try {
      // Send validation request to content script
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: (xpath) => {
          try {
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            return result.snapshotLength > 0;
          } catch (e) {
            return false;
          }
        },
        args: [xpath],
      });

      return result[0]?.result || false;
    } catch (e) {
      return false;
    }
  }

  // Unlock button functionality
  unlockButton.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      chrome.tabs.sendMessage(
        tab.id,
        { type: "UNLOCK_ELEMENT" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error unlocking element:", chrome.runtime.lastError);
          } else {
            console.log("Element unlocked successfully");
          }
        }
      );
    } catch (error) {
      console.error("Error sending unlock message:", error);
    }
  });

  // Toggle switch functionality
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      enableHover();
    } else {
      disableHover();
    }
  });

  async function enableHover() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      chrome.tabs.sendMessage(tab.id, { type: "ENABLE_HOVER" });
      chrome.storage.local.set({ isHoveringEnabled: true });
      status.textContent = "Hovering Enabled";
      status.className = "status active";
    } catch (error) {
      console.error("Error enabling hover:", error);
    }
  }

  async function disableHover() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      chrome.tabs.sendMessage(tab.id, { type: "DISABLE_HOVER" });
      chrome.storage.local.set({ isHoveringEnabled: false });
      status.textContent = "Hovering Disabled";
      status.className = "status";
    } catch (error) {
      console.error("Error disabling hover:", error);
    }
  }

  // Initial state setup
  clearButton.addEventListener("click", clearDisplay);

  // Handle popup close - notify content script to disable hover detection
  async function notifyPopupClosed() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "POPUP_CLOSED" });
      }
    } catch (error) {
      console.log("Error notifying content script of popup close:", error);
    }
  }

  // Use both beforeunload and unload for maximum reliability across browsers / edge cases
  window.addEventListener("beforeunload", notifyPopupClosed);
  window.addEventListener("unload", notifyPopupClosed);
});
