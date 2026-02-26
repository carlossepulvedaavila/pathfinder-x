document.addEventListener("DOMContentLoaded", async () => {
  // Establish a port so the background can detect when the panel closes.
  // Keep a reference to prevent the Port from being garbage-collected prematurely.
  const sidepanelPort = chrome.runtime.connect({ name: "sidepanel" }); // eslint-disable-line no-unused-vars

  const xpathContainer = document.getElementById("xpathContainer");
  const elementInfoContainer = document.getElementById("elementInfo");
  const elementTag = document.getElementById("elementTag");
  const elementText = document.getElementById("elementText");
  const frameInfoRow = document.getElementById("frameInfoRow");
  const frameInfo = document.getElementById("frameInfo");
  const shadowInfoRow = document.getElementById("shadowInfoRow");
  const shadowInfo = document.getElementById("shadowInfo");
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
        lockControls.style.display = "flex";
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
      }
    } else if (message.type === "XPATH_LOCKED") {
      isLocked = true;
      displayXPaths(
        message.xpaths,
        message.elementInfo,
        true,
        message.context
      );
      lockControls.style.display = "flex";
    } else if (message.type === "XPATH_CLEAR") {
      if (!isLocked) {
        clearDisplay();
      }
    } else if (message.type === "XPATH_UNLOCKED") {
      isLocked = false;
      lockControls.style.display = "none";
      clearDisplay();
    } else if (message.type === "TOGGLE_INSPECT") {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event("change"));
    }
  });

  function buildXPathCard(option) {
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

    optionDiv.appendChild(header);
    optionDiv.appendChild(content);
    content.appendChild(textSpan);
    content.appendChild(validation);

    // Return both the DOM element and refs for batch validation
    return { element: optionDiv, validation, option };
  }

  function applyValidationResult(validationDiv, result) {
    if (!result) {
      validationDiv.textContent = "Validation error";
      validationDiv.className = "validation invalid";
      return;
    }
    if (result.status === "unique") {
      validationDiv.textContent = "Unique";
      validationDiv.className = "validation valid";
    } else if (result.status === "multiple") {
      validationDiv.textContent = `${result.count} matches`;
      validationDiv.className = "validation manual";
    } else if (result.status === "manual") {
      validationDiv.textContent = result.message || "Manual check";
      validationDiv.className = "validation manual";
    } else {
      validationDiv.textContent = "Not found";
      validationDiv.className = "validation invalid";
    }
  }

  async function batchValidate(entries, context) {
    if (entries.length === 0) return;

    // Peek-through elements are validated at capture time via filterUniqueOptions.
    // Re-validation via executeScript would target the wrong frame.
    if (context?.frame?.peekThrough) {
      entries.forEach((e) =>
        applyValidationResult(e.validation, { status: "unique" })
      );
      return;
    }

    const shadowEntries = [];
    const standardEntries = [];

    for (const entry of entries) {
      if (entry.option.strategy === "shadow") {
        shadowEntries.push(entry);
      } else {
        standardEntries.push(entry);
      }
    }

    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        entries.forEach((e) => applyValidationResult(e.validation, { status: "invalid" }));
        return;
      }

      const target = { tabId: tab.id };
      const frameId = context?.frame?.frameId;
      if (typeof frameId === "number" && frameId >= 0) {
        target.frameIds = [frameId];
      }

      // Batch standard (xpath/css) validation in a single executeScript call
      if (standardEntries.length > 0) {
        const selectors = standardEntries.map((e) => ({
          value: e.option.xpath,
          strategy: e.option.strategy || "xpath",
        }));

        const result = await chrome.scripting.executeScript({
          target,
          function: (sels) => {
            return sels.map(({ value, strategy }) => {
              try {
                if (strategy === "css") {
                  return document.querySelectorAll(value).length;
                }
                const evaluation = document.evaluate(
                  value, document, null,
                  XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
                );
                return evaluation.snapshotLength;
              } catch (e) {
                return 0;
              }
            });
          },
          args: [selectors],
        });

        const counts = result?.[0]?.result || [];
        standardEntries.forEach((entry, i) => {
          const count = counts[i] || 0;
          if (count === 1) applyValidationResult(entry.validation, { status: "unique" });
          else if (count > 1) applyValidationResult(entry.validation, { status: "multiple", count });
          else applyValidationResult(entry.validation, { status: "invalid" });
        });
      }

      // Batch shadow validation (all share the same host chain)
      if (shadowEntries.length > 0) {
        const shadow = context?.shadow;
        if (!shadow || shadow.depth === 0 || !shadow.targetSelector) {
          shadowEntries.forEach((e) =>
            applyValidationResult(e.validation, { status: "manual", message: "Shadow DOM" })
          );
        } else {
          const result = await chrome.scripting.executeScript({
            target,
            function: (hosts, targetSelector) => {
              try {
                let scope = document;
                for (const host of hosts) {
                  const selector = host.selector || host.tagName?.toLowerCase();
                  if (!selector) return 0;
                  const nextHost = scope.querySelector(selector);
                  if (!nextHost || !nextHost.shadowRoot) return 0;
                  scope = nextHost.shadowRoot;
                }
                return scope.querySelectorAll(targetSelector).length;
              } catch (e) {
                return 0;
              }
            },
            args: [shadow.hosts || [], shadow.targetSelector],
          });

          const count = result?.[0]?.result || 0;
          const status =
            count === 1 ? { status: "unique" } :
            count > 1 ? { status: "multiple", count } :
            { status: "invalid" };
          shadowEntries.forEach((e) => applyValidationResult(e.validation, status));
        }
      }
    } catch (error) {
      entries.forEach((e) => applyValidationResult(e.validation, { status: "invalid" }));
    }
  }

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

    const allEntries = [];

    xpaths.forEach((option) => {
      const card = buildXPathCard(option);
      xpathContainer.appendChild(card.element);
      allEntries.push(card);
    });

    clearButton.style.display = "block";

    // Batch validate all selectors in minimal executeScript calls
    batchValidate(allEntries, context);
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
      : "Select an element";
    const br = document.createElement("br");
    const text = document.createTextNode(
      isLocked
        ? " Click 'Unlock' to resume hover detection."
        : " Hover and click to generate selectors."
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

  // Unlock button
  unlockButton.addEventListener("click", async () => {
    try {
      await sendMessageToAllFrames({ type: "UNLOCK_ELEMENT" });
    } catch (error) {
      // Unlock failed
    }
  });

  // Relay Space key to content script (side panel has focus, not the page)
  document.addEventListener("keydown", async (event) => {
    if (event.code !== "Space") return;
    // Don't intercept Space on interactive elements
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    event.preventDefault();
    try {
      await sendMessageToAllFrames({ type: "TOGGLE_LOCK" });
    } catch (error) {
      // Relay failed
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
    } catch (error) {
      // Enable failed
    }
  }

  async function disableHover() {
    try {
      await sendMessageToAllFrames({ type: "DISABLE_HOVER" });
      chrome.storage.local.set({ isHoveringEnabled: false });
      // Clear lock UI and state when inspection is toggled off
      if (isLocked) {
        isLocked = false;
        lockControls.style.display = "none";
      }
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
    try {
      const tab = await getActiveTab();
      if (!tab || tab.id !== tabId) return;

      if (changeInfo.status === "loading") {
        resetForNavigation(tabId);
      } else if (changeInfo.status === "complete") {
        // Re-inject content script and restore hover after page load
        await ensureContentScriptInjected();
        await sendMessageToAllFrames({ type: "PANEL_OPENED" });
        if (toggle.checked) {
          await sendMessageToAllFrames({ type: "ENABLE_HOVER" });
        } else {
          await sendMessageToAllFrames({ type: "DISABLE_HOVER" });
        }

      }
    } catch (error) {
      // Tab update handling failed
    }
  });

});
