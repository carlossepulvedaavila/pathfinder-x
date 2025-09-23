// Check if extension context is valid
function checkExtensionContext() {
  try {
    chrome.runtime.getURL("");
    return true;
  } catch (error) {
    return false;
  }
}

// Initialize content script only if extension context is valid
function initializeContentScript() {
  // Check if extension context is valid on load
  if (!checkExtensionContext()) {
    console.log(
      "Pathfinder-X: Extension context invalid, not initializing content script"
    );
    return false;
  }

  console.log("Pathfinder-X: Content script initialized");
  return true;
}

// Optimized XPath generation for Playwright and Selenium
function getOptimizedXPath(element) {
  // Priority 1: Use ID if available and unique
  if (
    element.id &&
    document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
  ) {
    return `//*[@id="${element.id}"]`;
  }

  // Priority 2: Use data-testid or similar test attributes
  const testAttributes = ["data-testid", "data-test", "data-cy", "data-qa"];
  for (const attr of testAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      return `//*[@${attr}="${value}"]`;
    }
  }

  // Priority 3: Use single meaningful class (common pattern)
  if (element.className && typeof element.className === "string") {
    const classes = element.className.trim().split(/\s+/).filter(Boolean);

    // Try single meaningful classes first
    const meaningfulClasses = classes.filter(
      (cls) =>
        cls.length > 2 &&
        !cls.match(
          /^(d-|flex-|text-|bg-|border-|p-|m-|col-|row-|btn-secondary|btn-primary)/
        ) &&
        !cls.match(/^[a-z]{1,2}$/) // Skip very short classes like "d", "p", "m"
    );

    for (const cls of meaningfulClasses) {
      const xpath = `//*[@class="${cls}"]`;
      if (
        document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        ).snapshotLength === 1
      ) {
        return xpath;
      }
    }

    // Try with contains for single meaningful class
    for (const cls of meaningfulClasses.slice(0, 3)) {
      // Only try first 3 meaningful classes
      const xpath = `//${element.tagName.toLowerCase()}[contains(@class,"${cls}")]`;
      if (
        document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        ).snapshotLength === 1
      ) {
        return xpath;
      }
    }
  }

  // Priority 4: Use unique attributes with tag name for specificity
  const uniqueAttrs = [
    "name",
    "type",
    "aria-label",
    "title",
    "alt",
    "placeholder",
    "role",
  ];
  for (const attr of uniqueAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      const xpath = `//${element.tagName.toLowerCase()}[@${attr}="${value}"]`;
      if (
        document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        ).snapshotLength === 1
      ) {
        return xpath;
      }
    }
  }

  // Priority 5: Use text content for clickable elements (with tag specificity)
  if (
    ["A", "BUTTON", "SPAN", "LABEL"].includes(element.tagName) &&
    element.textContent
  ) {
    const text = element.textContent.trim();
    if (text && text.length < 30 && text.length > 2) {
      const xpath = `//${element.tagName.toLowerCase()}[normalize-space(text())="${text}"]`;
      if (
        document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        ).snapshotLength === 1
      ) {
        return xpath;
      }
    }
  }

  // Priority 6: Combination attributes (more specific)
  if (element.className && element.getAttribute("type")) {
    const type = element.getAttribute("type");
    const classes = element.className.trim().split(/\s+/).filter(Boolean);
    const meaningfulClass = classes.find(
      (cls) => cls.length > 3 && !cls.match(/^(d-|flex-|text-|bg-)/)
    );

    if (meaningfulClass) {
      const xpath = `//${element.tagName.toLowerCase()}[@type="${type}" and contains(@class,"${meaningfulClass}")]`;
      if (
        document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        ).snapshotLength === 1
      ) {
        return xpath;
      }
    }
  }

  // Fallback: Generate structural path with optimizations
  return getStructuralXPath(element);
}

function getStructuralXPath(element) {
  if (element.tagName === "HTML") {
    return "/html";
  }

  if (element.tagName === "BODY") {
    return "/html/body";
  }

  const parent = element.parentNode;
  if (!parent || parent.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName
  );

  let position = "";
  if (siblings.length > 1) {
    const index = siblings.indexOf(element) + 1;
    position = `[${index}]`;
  }

  const parentPath = getStructuralXPath(parent);
  return `${parentPath}/${element.tagName.toLowerCase()}${position}`;
}

// Generate multiple XPath options for better reliability
function generateXPathOptions(element) {
  console.log("generateXPathOptions: Starting for element:", element);
  const options = [];

  try {
    // Add the optimized XPath
    const optimized = getOptimizedXPath(element);
    console.log("generateXPathOptions: Optimized XPath:", optimized);
    options.push({ type: "Optimized", xpath: optimized });

    // Add alternative short XPaths
    const alternatives = generateAlternativeXPaths(element);
    console.log("generateXPathOptions: Alternatives:", alternatives);
    alternatives.forEach((alt) => {
      if (
        alt.xpath !== optimized &&
        !options.find((opt) => opt.xpath === alt.xpath)
      ) {
        options.push(alt);
      }
    });

    // Add structural XPath as fallback (only if it's not too long)
    const structural = getStructuralXPath(element);
    console.log("generateXPathOptions: Structural XPath:", structural);
    if (structural !== optimized && structural.split("/").length < 8) {
      options.push({ type: "Structural", xpath: structural });
    }

    // Add CSS selector equivalent if useful
    try {
      const cssSelector = getCSSSelector(element);
      console.log("generateXPathOptions: CSS Selector:", cssSelector);
      if (cssSelector && cssSelector.length < 100) {
        options.push({ type: "CSS Selector", xpath: cssSelector });
      }
    } catch (e) {
      console.log("generateXPathOptions: CSS selector generation failed:", e);
    }

    console.log("generateXPathOptions: Final options:", options);
    return options.slice(0, 4); // Limit to 4 options for clean UI
  } catch (error) {
    console.error("generateXPathOptions: Error generating XPaths:", error);
    // Return at least one option as fallback
    return [{ type: "Basic", xpath: getStructuralXPath(element) }];
  }
}

function generateAlternativeXPaths(element) {
  const alternatives = [];

  // Alternative 1: Tag + any meaningful attribute
  const meaningfulAttrs = [
    "name",
    "type",
    "placeholder",
    "aria-label",
    "title",
  ];
  for (const attr of meaningfulAttrs) {
    const value = element.getAttribute(attr);
    if (value && value.length < 50) {
      alternatives.push({
        type: `By ${attr}`,
        xpath: `//${element.tagName.toLowerCase()}[@${attr}="${value}"]`,
      });
      break; // Only add one attribute-based alternative
    }
  }

  // Alternative 2: Tag + partial class match
  if (element.className) {
    const classes = element.className.trim().split(/\s+/).filter(Boolean);
    const meaningfulClass = classes.find(
      (cls) =>
        cls.length > 3 && !cls.match(/^(d-|flex|text-|bg-|border-|p-|m-|col-)/)
    );

    if (meaningfulClass) {
      alternatives.push({
        type: "By class",
        xpath: `//${element.tagName.toLowerCase()}[contains(@class,"${meaningfulClass}")]`,
      });
    }
  }

  // Alternative 3: Text content (for buttons, links, etc.)
  if (
    ["BUTTON", "A", "SPAN", "LABEL", "H1", "H2", "H3"].includes(element.tagName)
  ) {
    const text = element.textContent?.trim();
    if (text && text.length > 2 && text.length < 30) {
      alternatives.push({
        type: "By text",
        xpath: `//${element.tagName.toLowerCase()}[contains(text(),"${text}")]`,
      });
    }
  }

  // Alternative 4: Position-based (only for common interactive elements)
  if (["INPUT", "BUTTON", "SELECT", "A"].includes(element.tagName)) {
    const similarElements = document.querySelectorAll(
      element.tagName.toLowerCase()
    );
    const position = Array.from(similarElements).indexOf(element) + 1;
    if (position > 0 && position <= 5) {
      // Only if it's among the first 5
      alternatives.push({
        type: "By position",
        xpath: `(//${element.tagName.toLowerCase()})[${position}]`,
      });
    }
  }

  return alternatives;
}

function getCSSSelector(element) {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const path = [];
  let current = element;

  while (
    current &&
    current.nodeType === Node.ELEMENT_NODE &&
    current !== document.body
  ) {
    let selector = current.tagName.toLowerCase();

    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        selector += "." + classes.map((c) => CSS.escape(c)).join(".");
      }
    }

    const siblings = Array.from(current.parentNode?.children || []).filter(
      (s) => s.tagName === current.tagName
    );

    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }

    path.unshift(selector);
    current = current.parentNode;
  }

  return path.length > 0 ? path.join(" > ") : null;
}

// Visual highlighting and performance optimization
let highlightedElement = null;
let lastElement = null;
let throttleTimeout = null;
let isExtensionValid = true;
let contextCheckInterval = null;
let lockedElement = null; // Track locked element
let isLocked = false; // Track if element is locked
let isPopupOpen = false; // Track if popup is open
let hoverEnabled = false; // Track if hover detection should be active
let listenersAttached = false; // Track if hover listeners are attached

// Cleanup function to remove event listeners and highlights
function cleanup() {
  isExtensionValid = false;
  removeHighlight();

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
    throttleTimeout = null;
  }

  if (contextCheckInterval) {
    clearInterval(contextCheckInterval);
    contextCheckInterval = null;
  }

  // Detach hover listeners if present
  detachHoverListeners();

  console.log("Pathfinder-X content script cleaned up");
}

function attachHoverListeners() {
  if (listenersAttached) return;
  document.addEventListener("mouseover", handleMouseOver, { passive: true });
  document.addEventListener("mouseout", handleMouseOut, { passive: true });
  document.addEventListener("click", handleClick, { passive: false });
  document.addEventListener("keydown", handleKeyDown, { passive: false });
  listenersAttached = true;
  console.log("Content script: Hover listeners attached");
}

function detachHoverListeners() {
  if (!listenersAttached) return;
  document.removeEventListener("mouseover", handleMouseOver);
  document.removeEventListener("mouseout", handleMouseOut);
  document.removeEventListener("click", handleClick);
  document.removeEventListener("keydown", handleKeyDown);
  listenersAttached = false;
  console.log("Content script: Hover listeners detached");
}
function createHighlightOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "pathfinder-x-highlight";
  overlay.style.cssText = `
    position: absolute;
    background: rgba(255, 0, 0, 0.3);
    border: 2px solid #ff0000;
    pointer-events: none;
    z-index: 999999;
    box-sizing: border-box;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function updateHighlightStyle(locked = false) {
  if (highlightedElement) {
    if (locked) {
      highlightedElement.style.background = "rgba(255, 193, 7, 0.4)";
      highlightedElement.style.border = "2px solid #ffc107";
      highlightedElement.style.boxShadow = "0 0 0 2px rgba(255, 193, 7, 0.3)";
    } else {
      highlightedElement.style.background = "rgba(255, 0, 0, 0.3)";
      highlightedElement.style.border = "2px solid #ff0000";
      highlightedElement.style.boxShadow = "none";
    }
  }
}

function highlightElement(element) {
  if (!highlightedElement) {
    highlightedElement = createHighlightOverlay();
  }

  const rect = element.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  highlightedElement.style.top = rect.top + scrollTop + "px";
  highlightedElement.style.left = rect.left + scrollLeft + "px";
  highlightedElement.style.width = rect.width + "px";
  highlightedElement.style.height = rect.height + "px";
  highlightedElement.style.display = "block";
}

function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.style.display = "none";
  }
}

// Throttled mouseover handler for performance
function handleMouseOver(event) {
  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  // Only process hover events if popup is open, hover is enabled, and not locked
  if (!isPopupOpen || !hoverEnabled || isLocked) {
    return;
  }

  const element = event.target;

  // Skip if same element or if it's our highlight overlay
  if (element === lastElement || element.id === "pathfinder-x-highlight") {
    return;
  }

  lastElement = element;

  // Clear previous timeout
  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
  }

  // Throttle XPath generation but highlight immediately
  highlightElement(element);
  updateHighlightStyle(false); // Ensure it's the default highlight

  throttleTimeout = setTimeout(() => {
    console.log("Content script: Generating XPath for element:", element);
    const xpathOptions = generateXPathOptions(element);
    console.log("Content script generated XPaths:", xpathOptions);

    if (!xpathOptions || xpathOptions.length === 0) {
      console.error("Content script: No XPath options generated!");
      return;
    }

    const message = {
      type: "XPATH_FOUND",
      xpaths: xpathOptions,
      elementInfo: {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        textContent: element.textContent
          ? element.textContent.trim().substring(0, 50)
          : "",
      },
    };

    console.log("Content script sending message:", message);

    // Send message with error handling
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.log(
            "Content script: Runtime error:",
            chrome.runtime.lastError
          );
          cleanup();
        }
      });
    } catch (error) {
      console.log("Content script: Exception sending message:", error);
      cleanup();
    }
  }, 50); // 50ms throttle
}

function handleMouseOut(event) {
  // Only clear highlight if not locked
  if (isLocked) return;

  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  // Only process mouseout events if popup is open and hover is enabled
  if (!isPopupOpen || !hoverEnabled) {
    return;
  }

  // Only remove highlight if we're not moving to a child element
  if (
    !event.relatedTarget ||
    !event.currentTarget.contains(event.relatedTarget)
  ) {
    removeHighlight();
    lastElement = null;

    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }

    // Send message with error handling
    try {
      chrome.runtime.sendMessage({ type: "XPATH_CLEAR" }, (response) => {
        if (chrome.runtime.lastError) {
          cleanup();
        }
      });
    } catch (error) {
      cleanup();
    }
  }
}

function handleClick(event) {
  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  // Only process click events if popup is open and hover is enabled
  if (!isPopupOpen || !hoverEnabled) {
    return;
  }

  const element = event.target;

  // Skip if clicking on certain elements
  if (
    element.tagName === "HTML" ||
    element.tagName === "BODY" ||
    element === document.documentElement ||
    element.id === "pathfinder-x-highlight"
  ) {
    return;
  }

  // Prevent default action and stop propagation to avoid interfering with page
  event.preventDefault();
  event.stopPropagation();

  // Lock the element
  lockElement(element);
}

// Add a new function to handle locking the element
function lockElement(element) {
  if (isLocked) return; // Already locked

  isLocked = true;
  lockedElement = element;

  // Highlight the locked element
  highlightElement(lockedElement);
  updateHighlightStyle(true); // Use locked style

  // Generate XPath options for the locked element
  const xpathOptions = generateXPathOptions(lockedElement);
  console.log("Content script: Element locked", lockedElement);
  console.log(
    "Content script generated XPaths for locked element:",
    xpathOptions
  );

  if (!xpathOptions || xpathOptions.length === 0) {
    console.error(
      "Content script: No XPath options generated for locked element!"
    );
    return;
  }

  const message = {
    type: "XPATH_LOCKED",
    xpaths: xpathOptions,
    elementInfo: {
      tagName: lockedElement.tagName,
      id: lockedElement.id,
      className: lockedElement.className,
      textContent: lockedElement.textContent
        ? lockedElement.textContent.trim().substring(0, 50)
        : "",
    },
  };

  console.log("Content script sending locked message:", message);

  // Send locked message to background script
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.log("Error sending locked message:", chrome.runtime.lastError);
        cleanup();
      }
    });
  } catch (error) {
    console.log("Exception sending locked message:", error);
    cleanup();
  }
}

// Add a new function to handle keydown events for locking
function handleKeyDown(event) {
  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  // Lock on Shift key press, but only if an element is being hovered
  if (event.key === "Shift" && lastElement && !isLocked) {
    event.preventDefault();
    event.stopPropagation();
    lockElement(lastElement);
  }
}

// Function to unlock element
function unlockElement() {
  isLocked = false;
  lockedElement = null;
  removeHighlight();

  // Send unlock message to popup
  try {
    chrome.runtime.sendMessage({ type: "XPATH_UNLOCKED" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("Error sending unlock message:", chrome.runtime.lastError);
        cleanup();
      }
    });
  } catch (error) {
    console.log("Exception sending unlock message:", error);
    cleanup();
  }

  // Re-enable hover detection
  hoverEnabled = true;
  console.log("Content script: Element unlocked, hover detection re-enabled");
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "UNLOCK_ELEMENT") {
    unlockElement();
    sendResponse({ success: true });
  } else if (message.type === "POPUP_OPENED") {
    isPopupOpen = true;
    hoverEnabled = true;
    attachHoverListeners();
    console.log("Content script: Popup opened, hover detection enabled");
    sendResponse({ success: true });
  } else if (message.type === "POPUP_CLOSED") {
    isPopupOpen = false;
    hoverEnabled = false;
    if (isLocked) {
      unlockElement();
    }
    removeHighlight();
    lastElement = null;
    detachHoverListeners();
    console.log("Content script: Popup closed, hover detection disabled");
    sendResponse({ success: true });
  } else if (message.type === "ENABLE_HOVER") {
    hoverEnabled = true;
    console.log("Content script: Hover detection enabled");
    sendResponse({ success: true });
  } else if (message.type === "DISABLE_HOVER") {
    hoverEnabled = false;
    removeHighlight();
    lastElement = null;
    console.log("Content script: Hover detection disabled");
    sendResponse({ success: true });
  }
});

// Initialize the extension if context is valid
if (initializeContentScript()) {
  // Do NOT attach hover listeners yet; wait for popup to open

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    removeHighlight();
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
    }
    detachHoverListeners();
  });

  console.log(
    "Pathfinder-X: Base content script setup complete; listeners will attach when popup opens"
  );

  // Periodic check for extension context (every 5 seconds)
  contextCheckInterval = setInterval(() => {
    if (!checkExtensionContext()) {
      console.log("Pathfinder-X: Extension context lost, cleaning up...");
      cleanup();
    }
  }, 5000);
} else {
  console.log(
    "Pathfinder-X: Skipping event listener setup due to invalid context"
  );
}
