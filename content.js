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

  // Remove event listeners
  document.removeEventListener("mouseover", handleMouseOver);
  document.removeEventListener("mouseout", handleMouseOut);

  console.log("Pathfinder-X content script cleaned up");
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

    // Store in chrome.storage for popup to read
    chrome.storage.local.set({
      currentXPath: message,
      timestamp: Date.now(),
    });

    // Send message with error handling
    try {
      console.log("Content script: About to send message to background");
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.log(
            "Content script: Runtime error:",
            chrome.runtime.lastError
          );
          console.log("Extension context invalidated, cleaning up...");
          cleanup();
        } else {
          console.log(
            "Content script: Message sent successfully, response:",
            response
          );
        }
      });
    } catch (error) {
      console.log("Content script: Exception sending message:", error);
      console.log("Extension context invalidated, cleaning up...");
      cleanup();
    }
  }, 50); // 50ms throttle
}

function handleMouseOut(event) {
  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
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

    // Store clear message
    chrome.storage.local.set({
      currentXPath: { type: "XPATH_CLEAR" },
      timestamp: Date.now(),
    });

    // Send message with error handling
    try {
      chrome.runtime.sendMessage(
        {
          type: "XPATH_CLEAR",
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log("Extension context invalidated, cleaning up...");
            cleanup();
          }
        }
      );
    } catch (error) {
      console.log("Extension context invalidated, cleaning up...");
      cleanup();
    }
  }
}

// Initialize the extension if context is valid
if (initializeContentScript()) {
  // Event listeners with performance optimizations
  document.addEventListener("mouseover", handleMouseOver, { passive: true });
  document.addEventListener("mouseout", handleMouseOut, { passive: true });

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    removeHighlight();
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
    }
  });

  console.log("Pathfinder-X: Event listeners attached successfully");

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
