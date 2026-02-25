document.addEventListener("DOMContentLoaded", async () => {
  // Establish a port so the background can detect when the panel closes
  chrome.runtime.connect({ name: "sidepanel" });

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

  let currentXPaths = [];
  let currentContext = null;
  let isLocked = false;

  function storageKeyForTab(tabId) {
    return `tabState_${tabId}`;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab;
  }

  // Ensure content script is injected into the active tab
  async function ensureContentScriptInjected() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return false;

    // Skip restricted URLs where content scripts can't run
    if (
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("about:") ||
      tab.url.startsWith("edge://")
    ) {
      return false;
    }

    // Try pinging the content script first
    const alive = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "PING" }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });

    if (alive) return true;

    // Content script not loaded — inject it programmatically
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"],
      });
      // Small delay to let the script initialize
      await new Promise((r) => setTimeout(r, 100));
      return true;
    } catch (error) {
      return false;
    }
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
        // Fall through to top-frame-only send
      }

      if (!frames || frames.length === 0) {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, message, () => {
            if (chrome.runtime.lastError) {
              // Content script may not be loaded on this page
            }
            resolve();
          });
        });
        return;
      }

      await Promise.all(
        frames.map(
          (frame) =>
            new Promise((resolve) => {
              chrome.tabs.sendMessage(
                tab.id,
                message,
                { frameId: frame.frameId },
                () => {
                  if (chrome.runtime.lastError) {
                    // Frame may not have content script
                  }
                  resolve();
                }
              );
            })
        )
      );
    } catch (error) {
      // Failed to broadcast
    }
  }

  // Restore saved state for a given tab
  async function restoreTabState(tabId) {
    if (!tabId) {
      clearDisplay();
      return;
    }

    const key = storageKeyForTab(tabId);
    const result = await chrome.storage.local.get(key);
    const saved = result?.[key];

    if (
      saved &&
      (saved.type === "XPATH_FOUND" || saved.type === "XPATH_LOCKED")
    ) {
      const locked = saved.type === "XPATH_LOCKED";
      displayXPaths(saved.xpaths, saved.elementInfo, locked, saved.context);

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
      clearDisplay();
    }
  }

  // Ensure content script is loaded, then notify it that the panel is open
  try {
    await ensureContentScriptInjected();
    await sendMessageToAllFrames({ type: "PANEL_OPENED" });

    chrome.storage.local.get("isHoveringEnabled", (result) => {
      if (chrome.runtime.lastError || !result) {
        clearDisplay();
        return;
      }

      const isHoveringEnabled = result.isHoveringEnabled !== false;
      toggle.checked = isHoveringEnabled;

      if (isHoveringEnabled) {
        enableHover().catch(() => {});
      } else {
        disableHover().catch(() => {});
      }
    });

    const tab = await getActiveTab();
    await restoreTabState(tab?.id);
  } catch (error) {
    // Content script not available on this page
  }

  // Listen for real-time updates from background script
  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only accept messages from our own extension
    if (sender.id && sender.id !== chrome.runtime.id) {
      return;
    }

    if (message.type === "XPATH_FOUND") {
      if (!isLocked) {
        displayXPaths(
          message.xpaths,
          message.elementInfo,
          false,
          message.context
        );
        status.textContent = "Hovering - click to select";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_LOCKED") {
      isLocked = true;
      displayXPaths(
        message.xpaths,
        message.elementInfo,
        true,
        message.context
      );
      status.textContent = "Element Locked";
      status.className = "status active locked";
      lockControls.style.display = "flex";
    } else if (message.type === "XPATH_CLEAR") {
      if (!isLocked) {
        clearDisplay();
        status.textContent = "Hover for XPath";
        status.className = "status active";
      }
    } else if (message.type === "XPATH_UNLOCKED") {
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

    // Clear container safely
    xpathContainer.textContent = "";

    if (!xpaths || !Array.isArray(xpaths)) {
      return;
    }

    xpaths.forEach((option) => {
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
    // Build placeholder with safe DOM methods
    xpathContainer.textContent = "";

    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";

    const img = document.createElement("img");
    img.className = "placeholder__icon";
    img.src = isLocked
      ? "./images/locked-icon.png"
      : "./images/hover-icon.png";
    img.alt = "Hover Icon";

    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = isLocked
      ? "Element is locked."
      : "Hover over any element on the page";
    const br = document.createElement("br");
    const text = document.createTextNode(
      isLocked
        ? " Click 'Unlock' to resume hover detection."
        : " to generate XPath selectors optimized for Playwright and Selenium."
    );

    p.appendChild(strong);
    p.appendChild(br);
    p.appendChild(text);
    placeholder.appendChild(img);
    placeholder.appendChild(p);
    xpathContainer.appendChild(placeholder);

    elementInfoContainer.style.display = "none";
    clearButton.style.display = "none";
    if (!isLocked) {
      lockControls.style.display = "none";
    }
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

  // Unlock button
  unlockButton.addEventListener("click", async () => {
    try {
      await sendMessageToAllFrames({ type: "UNLOCK_ELEMENT" });
    } catch (error) {
      // Unlock failed
    }
  });

  // Toggle switch
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      enableHover().catch(() => {});
    } else {
      disableHover().catch(() => {});
    }
  });

  async function enableHover() {
    try {
      await sendMessageToAllFrames({ type: "ENABLE_HOVER" });
      chrome.storage.local.set({ isHoveringEnabled: true });
      status.textContent = "Hovering Enabled";
      status.className = "status active";
    } catch (error) {
      // Enable failed
    }
  }

  async function disableHover() {
    try {
      await sendMessageToAllFrames({ type: "DISABLE_HOVER" });
      chrome.storage.local.set({ isHoveringEnabled: false });
      // Clear lock UI but keep XPath data visible for copying
      if (isLocked) {
        isLocked = false;
        lockControls.style.display = "none";
      }
      status.textContent = "Hovering Disabled";
      status.className = "status";
    } catch (error) {
      // Disable failed
    }
  }

  clearButton.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (tab?.id) {
      chrome.storage.local.remove(storageKeyForTab(tab.id));
    }
    if (isLocked) {
      isLocked = false;
      lockControls.style.display = "none";
      try {
        await sendMessageToAllFrames({ type: "UNLOCK_ELEMENT" });
      } catch (error) {
        // Unlock failed
      }
    }
    clearDisplay();
  });

  // Reset for same-tab navigation (old locked element no longer exists)
  function resetForNavigation(tabId) {
    isLocked = false;
    lockControls.style.display = "none";
    if (tabId) {
      chrome.storage.local.remove(storageKeyForTab(tabId));
    }
    clearDisplay();
  }

  // Restore state when switching to a different tab
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      // Reset UI first, then restore saved state for the new tab
      isLocked = false;
      lockControls.style.display = "none";
      clearDisplay();

      await ensureContentScriptInjected();
      const result = await chrome.storage.local.get("isHoveringEnabled");
      const isHoveringEnabled =
        !result || result.isHoveringEnabled !== false;
      if (isHoveringEnabled) {
        await sendMessageToAllFrames({ type: "PANEL_OPENED" });
        await sendMessageToAllFrames({ type: "ENABLE_HOVER" });
      }

      await restoreTabState(activeInfo.tabId);
    } catch (error) {
      // Tab change handling failed
    }
  });

  // Clear state when the page navigates within the same tab (element no longer exists)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== "loading") return;
    try {
      const tab = await getActiveTab();
      if (!tab || tab.id !== tabId) return;
      resetForNavigation(tabId);
    } catch (error) {
      // Tab update handling failed
    }
  });

  // Clean up storage when tabs are closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.remove(storageKeyForTab(tabId));
  });
});
