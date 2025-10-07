document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup: DOM loaded, initializing...");

  const xpathContainer = document.getElementById("xpathContainer");
  const elementInfoContainer = document.getElementById("elementInfo");
  const elementTag = document.getElementById("elementTag");
  const elementText = document.getElementById("elementText");
  const frameInfoRow = document.getElementById("frameInfoRow");
  const frameInfo = document.getElementById("frameInfo");
  const shadowInfoRow = document.getElementById("shadowInfoRow");
  const shadowInfo = document.getElementById("shadowInfo");
  const status = document.getElementById("status");
  const clearButton = document.getElementById("clearButton");
  const lockControls = document.getElementById("lockControls");
  const unlockButton = document.getElementById("unlockButton");
  const toggle = document.getElementById("toggle");

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab;
  }

  async function sendMessageToAllFrames(message) {
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        return;
      }

      let frames = [];

      try {
        frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      } catch (error) {
        console.log("Popup: Unable to enumerate frames, defaulting to top frame", error);
      }

      if (!frames || frames.length === 0) {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, message, () => {
            if (chrome.runtime.lastError) {
              console.log(
                "Popup: Error sending message to top frame:",
                chrome.runtime.lastError
              );
            }
            resolve();
          });
        });
        return;
      }

      await Promise.all(
        frames.map((frame) =>
          new Promise((resolve) => {
            chrome.tabs.sendMessage(
              tab.id,
              message,
              { frameId: frame.frameId },
              () => {
                if (chrome.runtime.lastError) {
                  console.log(
                    `Popup: Error sending message to frame ${frame.frameId}:`,
                    chrome.runtime.lastError
                  );
                }
                resolve();
              }
            );
          })
        )
      );
    } catch (error) {
      console.log("Popup: Failed to broadcast message to frames", error);
    }
  }

  // Notify content script that popup is opened
  try {
    await sendMessageToAllFrames({ type: "POPUP_OPENED" });

    // After popup is opened, check storage and set hover state
    chrome.storage.local.get(
      ["lastMessage", "isHoveringEnabled"],
      (result) => {
        console.log("Popup: Retrieved from storage:", result);

        // Set toggle state - default to true if not explicitly disabled
        const isHoveringEnabled = result.isHoveringEnabled !== false;
        toggle.checked = isHoveringEnabled;

        if (isHoveringEnabled) {
          enableHover().catch((error) =>
            console.error("Popup: Failed to enable hover from storage", error)
          );
        } else {
          disableHover().catch((error) =>
            console.error("Popup: Failed to disable hover from storage", error)
          );
        }

        // Handle stored messages
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
            locked,
            result.lastMessage.context
          );

          if (locked) {
            isLocked = true;
            status.textContent = "Element Locked";
            status.className = "status active locked";
            lockControls.style.display = "flex";
          } else {
            status.textContent = "Hover for XPath";
            status.className = "status active";
          }
        } else {
          console.log("Popup: No stored XPath data found, showing placeholder");
          clearDisplay();
        }
      }
    );
  } catch (error) {
    console.log("Error notifying content script:", error);
  }

  console.log("Popup: All DOM elements found:", {
    xpathContainer: !!xpathContainer,
    elementInfo: !!elementInfoContainer,
    elementTag: !!elementTag,
    elementText: !!elementText,
    status: !!status,
    clearButton: !!clearButton,
    lockControls: !!lockControls,
    unlockButton: !!unlockButton,
    toggle: !!toggle,
  });

  let currentXPaths = [];
  let currentContext = null;
  let isLocked = false;

  // 1. Listen for real-time updates from background script while popup is open
  chrome.runtime.onMessage.addListener((message) => {
    console.log("Popup: Received message:", message);
    if (message.type === "XPATH_FOUND") {
      console.log("Popup: Processing XPATH_FOUND message");
      if (!isLocked) {
        // Only update if not locked
        displayXPaths(message.xpaths, message.elementInfo, false, message.context);
        status.textContent = "Hovering - click to select";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_SELECTED") {
      console.log("Popup: Processing XPATH_SELECTED message");
      displayXPaths(message.xpaths, message.elementInfo, false, message.context);
      status.textContent = "Element selected - continue hovering";
      status.className = "status active selected";
    } else if (message.type === "XPATH_LOCKED") {
      console.log("Popup: Processing XPATH_LOCKED message");
      isLocked = true;
      displayXPaths(message.xpaths, message.elementInfo, true, message.context);
      status.textContent = "Element Locked";
      status.className = "status active locked";
      lockControls.style.display = "flex";
    } else if (message.type === "XPATH_CLEAR") {
      console.log("Popup: Processing XPATH_CLEAR message");
      if (!isLocked) {
        // Only clear if not locked
        status.textContent = "Hover for XPath";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_UNLOCKED") {
      console.log("Popup: Processing XPATH_UNLOCKED message");
      isLocked = false;
      lockControls.style.display = "none";
      clearDisplay();
    }
  });

  function displayXPaths(
    xpaths,
    elementDetails,
    locked = false,
    context = null
  ) {
    console.log("Popup: displayXPaths called with:", {
      xpaths,
      elementInfo: elementDetails,
      context,
    });

    currentXPaths = xpaths;
    currentContext = context;

    // Show element info
    if (elementDetails) {
      elementTag.textContent = `<${elementDetails.tagName.toLowerCase()}>`;
      elementText.textContent =
        elementDetails.textContent || "No text content";
      elementInfoContainer.style.display = "block";
    }

    if (context) {
      updateContextDisplay(context);
    } else {
      clearContextDisplay();
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
      copyBtn.onclick = () => copyXPath(option, copyBtn);

      header.appendChild(typeSpan);
      header.appendChild(copyBtn);

      const content = document.createElement("div");
      content.className = "xpath-content";

      const textSpan = document.createElement("span");
      textSpan.className = "xpath-text-highlight";
      textSpan.textContent = option.xpath;

      const validation = document.createElement("div");
      validation.className = "validation";

      // Validate XPath or selector
      validateXPath(option).then((result) => {
        if (!result) {
          validation.textContent = "Validation error";
          validation.className = "validation invalid";
          return;
        }

        if (result.status === "valid") {
          validation.textContent = "Valid";
          validation.className = "validation valid";
        } else if (result.status === "manual") {
          validation.textContent = result.message || "Manual check";
          validation.className = "validation manual";
        } else {
          validation.textContent = "Not found";
          validation.className = "validation invalid";
        }
      });

      optionDiv.appendChild(header);
      optionDiv.appendChild(content);
      content.appendChild(textSpan);
      content.appendChild(validation);

      xpathContainer.appendChild(optionDiv);
    });

    clearButton.style.display = "block";
  }

  function updateContextDisplay(context) {
    if (!context) {
      clearContextDisplay();
      return;
    }

    if (context.frame) {
      let summary = "Top frame";
      if (!context.frame.isTopFrame) {
        const selectors = (context.frame.selectors || []).join(" → ");
        let origin = context.frame.origin || "";
        if (!origin && context.frame.url) {
          try {
            origin = new URL(context.frame.url).origin;
          } catch (error) {
            origin = context.frame.url;
          }
        }
        const parts = [origin, selectors].filter(Boolean);
        summary = parts.join(" · ") || "Nested frame";
      }

      frameInfo.textContent = summary;
      frameInfoRow.style.display = "block";
    } else {
      frameInfoRow.style.display = "none";
      frameInfo.textContent = "";
    }

    if (context.shadow && context.shadow.depth > 0) {
      const hostSelectors = (context.shadow.hosts || [])
        .map((host) => host.selector || host.tagName?.toLowerCase())
        .filter(Boolean);

      if (context.shadow.targetSelector) {
        hostSelectors.push(context.shadow.targetSelector);
      }

      shadowInfo.textContent = hostSelectors.join(" → ");
      shadowInfoRow.style.display = "block";
    } else {
      shadowInfoRow.style.display = "none";
      shadowInfo.textContent = "";
    }
  }

  function clearContextDisplay() {
    frameInfoRow.style.display = "none";
    shadowInfoRow.style.display = "none";
    frameInfo.textContent = "";
    shadowInfo.textContent = "";
  }

  function clearDisplay() {
    const statusStrongText = isLocked
      ? "Element is locked."
      : "Hover over any element on the page";

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
    elementInfoContainer.style.display = "none";
    clearButton.style.display = "none";
    lockControls.style.display = "none";
    status.textContent = isLocked ? "Element Locked" : "Hover for XPath";
    status.className = isLocked ? "status active locked" : "status active";
    currentXPaths = [];
    currentContext = null;
    clearContextDisplay();
  }

  async function copyXPath(option, button) {
    try {
      await navigator.clipboard.writeText(option.xpath);
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.className = "copy-btn copied";

      setTimeout(() => {
        button.textContent = originalText;
        button.className = "copy-btn";
      }, 1800);
    } catch (err) {
      console.error("Failed to copy XPath:", err);
      button.textContent = "Error";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1800);
    }
  }

  async function validateXPath(option) {
    if (!option || !option.xpath) {
      return { status: "invalid" };
    }

    if (option.strategy === "shadow") {
      const shadow = currentContext?.shadow;
      if (!shadow || shadow.depth === 0 || !shadow.targetSelector) {
        return { status: "manual", message: "Shadow DOM" };
      }

      try {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
          return { status: "manual", message: "Shadow DOM" };
        }

        const target = { tabId: tab.id };
        const frameId = currentContext?.frame?.frameId;
        if (typeof frameId === "number" && frameId >= 0) {
          target.frameIds = [frameId];
        }

        const result = await chrome.scripting.executeScript({
          target,
          function: (hosts, targetSelector) => {
            try {
              let scope = document;
              for (const host of hosts) {
                const selector = host.selector || host.tagName?.toLowerCase();
                if (!selector) {
                  return false;
                }
                const nextHost = scope.querySelector(selector);
                if (!nextHost || !nextHost.shadowRoot) {
                  return false;
                }
                scope = nextHost.shadowRoot;
              }
              return !!scope.querySelector(targetSelector);
            } catch (error) {
              return false;
            }
          },
          args: [shadow.hosts || [], shadow.targetSelector],
        });

        const isValid = Boolean(result && result[0] && result[0].result);
        return { status: isValid ? "valid" : "invalid" };
      } catch (error) {
        return { status: "manual", message: "Shadow DOM" };
      }
    }

    const strategy = option.strategy || "xpath";

    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        return { status: "invalid" };
      }

      const target = { tabId: tab.id };
      const frameId = currentContext?.frame?.frameId;
      if (typeof frameId === "number" && frameId >= 0) {
        target.frameIds = [frameId];
      }

      const result = await chrome.scripting.executeScript({
        target,
        function: (value, strategy) => {
          try {
            if (strategy === "css") {
              return document.querySelectorAll(value).length > 0;
            }
            if (strategy === "xpath") {
              const evaluation = document.evaluate(
                value,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
              );
              return evaluation.snapshotLength > 0;
            }
            return false;
          } catch (error) {
            return false;
          }
        },
        args: [option.xpath, strategy],
      });

      const isValid = Boolean(result && result[0] && result[0].result);
      return { status: isValid ? "valid" : "invalid" };
    } catch (error) {
      return { status: "invalid" };
    }
  }

  // Unlock button functionality
  unlockButton.addEventListener("click", async () => {
    try {
      await sendMessageToAllFrames({ type: "UNLOCK_ELEMENT" });
      console.log("Popup: Broadcast unlock request to frames");
    } catch (error) {
      console.error("Error sending unlock message:", error);
    }
  });

  // Toggle switch functionality
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      enableHover().catch((error) =>
        console.error("Popup: Failed to enable hover", error)
      );
    } else {
      disableHover().catch((error) =>
        console.error("Popup: Failed to disable hover", error)
      );
    }
  });

  async function enableHover() {
    try {
      await sendMessageToAllFrames({ type: "ENABLE_HOVER" });
      console.log("Popup: Successfully enabled hover in content scripts");
      chrome.storage.local.set({ isHoveringEnabled: true });
      status.textContent = "Hovering Enabled";
      status.className = "status active";
      console.log("Popup: Hover enabled, toggle set to true");
    } catch (error) {
      console.error("Error enabling hover:", error);
    }
  }

  async function disableHover() {
    try {
      await sendMessageToAllFrames({ type: "DISABLE_HOVER" });
      console.log("Popup: Successfully disabled hover in content scripts");
      chrome.storage.local.set({ isHoveringEnabled: false });
      status.textContent = "Hovering Disabled";
      status.className = "status";
      console.log("Popup: Hover disabled, toggle set to false");
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
        await sendMessageToAllFrames({ type: "POPUP_CLOSED" });
      }
    } catch (error) {
      console.log("Error notifying content script of popup close:", error);
    }
  }

  // Use both beforeunload and unload for maximum reliability across browsers / edge cases
  window.addEventListener("beforeunload", notifyPopupClosed);
  window.addEventListener("unload", notifyPopupClosed);
});
