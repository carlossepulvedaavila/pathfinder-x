// Prevent double-initialization when injected both by manifest and scripting API
if (window.__pathfinderXLoaded) {
  // Already running — just re-register the message listener is not needed
  // since the first instance is still active
} else {
window.__pathfinderXLoaded = true;

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
  if (!checkExtensionContext()) {
    return false;
  }
  return true;
}

// XPath string escaping to prevent injection from element attributes
function escapeXPathString(str) {
  if (!str) return '""';
  if (!str.includes('"')) return `"${str}"`;
  if (!str.includes("'")) return `'${str}'`;
  // Use concat() for strings containing both quote types
  const parts = str.split('"');
  const escaped = parts
    .map((part, i) => (i === 0 ? `"${part}"` : `concat('"',"${part}")`))
    .join(",");
  return parts.length > 1 ? `concat(${escaped})` : `"${str}"`;
}

// Optimized XPath generation for Playwright and Selenium
function getOptimizedXPath(element) {
  // Priority 1: Use ID if available and unique
  if (
    element.id &&
    document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
  ) {
    return `//*[@id=${escapeXPathString(element.id)}]`;
  }

  // Priority 2: Use data-testid or similar test attributes
  const testAttributes = ["data-testid", "data-test", "data-cy", "data-qa"];
  for (const attr of testAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      return `//*[@${attr}=${escapeXPathString(value)}]`;
    }
  }

  // Priority 3: Use single meaningful class (common pattern)
  if (element.className && typeof element.className === "string") {
    const classes = element.className.trim().split(/\s+/).filter(Boolean);

    const meaningfulClasses = classes.filter(
      (cls) =>
        cls.length > 2 &&
        !cls.match(
          /^(d-|flex-|text-|bg-|border-|p-|m-|col-|row-|btn-secondary|btn-primary)/
        ) &&
        !cls.match(/^[a-z]{1,2}$/)
    );

    for (const cls of meaningfulClasses) {
      const xpath = `//*[@class=${escapeXPathString(cls)}]`;
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

    for (const cls of meaningfulClasses.slice(0, 3)) {
      const xpath = `//${element.tagName.toLowerCase()}[contains(@class,${escapeXPathString(cls)})]`;
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
      const xpath = `//${element.tagName.toLowerCase()}[@${attr}=${escapeXPathString(value)}]`;
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

  // Priority 5: Use text content for clickable elements
  if (
    ["A", "BUTTON", "SPAN", "LABEL"].includes(element.tagName) &&
    element.textContent
  ) {
    const text = element.textContent.trim();
    if (text && text.length < 30 && text.length > 2) {
      const xpath = `//${element.tagName.toLowerCase()}[normalize-space(text())=${escapeXPathString(text)}]`;
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

  // Priority 6: Combination attributes
  if (element.className && element.getAttribute("type")) {
    const type = element.getAttribute("type");
    const classes = element.className.trim().split(/\s+/).filter(Boolean);
    const meaningfulClass = classes.find(
      (cls) => cls.length > 3 && !cls.match(/^(d-|flex-|text-|bg-)/)
    );

    if (meaningfulClass) {
      const xpath = `//${element.tagName.toLowerCase()}[@type=${escapeXPathString(type)} and contains(@class,${escapeXPathString(meaningfulClass)})]`;
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

  // Fallback: Generate structural path
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

// Generate multiple XPath options
function generateXPathOptions(element) {
  const options = [];

  try {
    const optimized = getOptimizedXPath(element);
    options.push({ type: "Optimized", xpath: optimized, strategy: "xpath" });

    const alternatives = generateAlternativeXPaths(element);
    alternatives.forEach((alt) => {
      if (
        alt.xpath !== optimized &&
        !options.find((opt) => opt.xpath === alt.xpath)
      ) {
        options.push(alt);
      }
    });

    const structural = getStructuralXPath(element);
    if (structural !== optimized && structural.split("/").length < 8) {
      options.push({
        type: "Structural",
        xpath: structural,
        strategy: "xpath",
      });
    }

    try {
      const cssSelector = getCSSSelector(element);
      if (cssSelector && cssSelector.length < 100) {
        options.push({
          type: "CSS Selector",
          xpath: cssSelector,
          strategy: "css",
        });
      }
    } catch (e) {
      // CSS selector generation failed
    }

    const shadowLocator = buildShadowLocator(element);
    if (
      shadowLocator &&
      !options.find((opt) => opt.type === "Shadow Locator")
    ) {
      options.push({
        type: "Shadow Locator",
        xpath: shadowLocator,
        strategy: "shadow",
      });
    }

    if (options.length > 5) {
      const shadowOption = options.find((opt) => opt.strategy === "shadow");
      if (shadowOption) {
        const trimmed = options
          .filter((opt) => opt.strategy !== "shadow")
          .slice(0, 4);
        trimmed.push(shadowOption);
        return trimmed;
      }
      return options.slice(0, 5);
    }

    return options;
  } catch (error) {
    return [
      {
        type: "Basic",
        xpath: getStructuralXPath(element),
        strategy: "xpath",
      },
    ];
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
        xpath: `//${element.tagName.toLowerCase()}[@${attr}=${escapeXPathString(value)}]`,
        strategy: "xpath",
      });
      break;
    }
  }

  // Alternative 2: Tag + partial class match
  if (element.className && typeof element.className === "string") {
    const classes = element.className.trim().split(/\s+/).filter(Boolean);
    const meaningfulClass = classes.find(
      (cls) =>
        cls.length > 3 &&
        !cls.match(/^(d-|flex|text-|bg-|border-|p-|m-|col-)/)
    );

    if (meaningfulClass) {
      alternatives.push({
        type: "By class",
        xpath: `//${element.tagName.toLowerCase()}[contains(@class,${escapeXPathString(meaningfulClass)})]`,
        strategy: "xpath",
      });
    }
  }

  // Alternative 3: Text content
  if (
    ["BUTTON", "A", "SPAN", "LABEL", "H1", "H2", "H3"].includes(
      element.tagName
    )
  ) {
    const text = element.textContent?.trim();
    if (text && text.length > 2 && text.length < 30) {
      alternatives.push({
        type: "By text",
        xpath: `//${element.tagName.toLowerCase()}[contains(text(),${escapeXPathString(text)})]`,
        strategy: "xpath",
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
      alternatives.push({
        type: "By position",
        xpath: `(//${element.tagName.toLowerCase()})[${position}]`,
        strategy: "xpath",
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

function buildShadowLocator(element) {
  if (!element) {
    return null;
  }

  const shadowCtor = typeof ShadowRoot !== "undefined" ? ShadowRoot : null;
  const root = element.getRootNode();
  if (!shadowCtor || !(root instanceof shadowCtor)) {
    return null;
  }

  const chain = [];
  let current = element;
  let currentRoot = root;

  const targetSelector = getCSSSelector(current);
  if (!targetSelector) {
    return null;
  }

  chain.unshift({ selector: targetSelector, type: "element" });

  while (shadowCtor && currentRoot instanceof shadowCtor) {
    const host = currentRoot.host;
    if (!host) {
      break;
    }

    const hostSelector = getCSSSelector(host);
    if (!hostSelector) {
      return null;
    }

    chain.unshift({ selector: hostSelector, type: "host" });
    current = host;
    currentRoot = host.getRootNode();
  }

  let expression = "document";

  chain.forEach((step, index) => {
    // Use CSS.escape via the selector which was already built with CSS.escape
    const normalized = step.selector.replace(/'/g, "\\'");
    expression += `.querySelector('${normalized}')`;
    if (index !== chain.length - 1) {
      expression += ".shadowRoot";
    }
  });

  return expression;
}

function buildShadowContext(element) {
  if (!element) {
    return null;
  }

  const shadowCtor = typeof ShadowRoot !== "undefined" ? ShadowRoot : null;
  const root = element.getRootNode();
  if (!shadowCtor || !(root instanceof shadowCtor)) {
    return null;
  }

  const hosts = [];
  let current = element;
  let currentRoot = root;

  while (shadowCtor && currentRoot instanceof shadowCtor) {
    const host = currentRoot.host;
    if (!host) {
      break;
    }

    const hostSelector = getCSSSelector(host);
    hosts.unshift({
      tagName: host.tagName,
      selector: hostSelector || host.tagName.toLowerCase(),
    });

    current = host;
    currentRoot = host.getRootNode();
  }

  const locator = buildShadowLocator(element);

  return {
    depth: hosts.length,
    hosts,
    locator,
    targetSelector: getCSSSelector(element),
  };
}

function describeFrameElement(frameEl) {
  if (!frameEl) {
    return null;
  }

  if (frameEl.id) {
    return `#${CSS.escape(frameEl.id)}`;
  }

  if (frameEl.name) {
    return `${frameEl.tagName.toLowerCase()}[name=${escapeXPathString(frameEl.name)}]`;
  }

  const src = frameEl.getAttribute("src");
  if (src) {
    return `${frameEl.tagName.toLowerCase()}[src=${escapeXPathString(src)}]`;
  }

  const parent = frameEl.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === frameEl.tagName
    );
    const index = siblings.indexOf(frameEl) + 1;
    return `${frameEl.tagName.toLowerCase()}:nth-of-type(${index})`;
  }

  return frameEl.tagName.toLowerCase();
}

function getFrameMetadata() {
  const isTopFrame = window.top === window;
  const selectors = [];

  if (!isTopFrame) {
    let currentWindow = window;

    while (true) {
      let parentWindow;
      try {
        parentWindow = currentWindow.parent;
      } catch (error) {
        selectors.unshift("<cross-origin-parent>");
        break;
      }

      if (!parentWindow || parentWindow === currentWindow) {
        break;
      }

      try {
        const frameElement = currentWindow.frameElement;
        const descriptor = describeFrameElement(frameElement);
        if (descriptor) {
          selectors.unshift(descriptor);
        }
        currentWindow = parentWindow;
      } catch (error) {
        selectors.unshift("<cross-origin-parent>");
        break;
      }

      if (currentWindow === window.top) {
        break;
      }
    }
  }

  return {
    isTopFrame,
    url: window.location.href,
    origin: window.location.origin,
    selectors,
  };
}

function buildElementInfo(element, context) {
  return {
    tagName: element?.tagName || "",
    id: element?.id || "",
    className: element?.className || "",
    textContent: element?.textContent
      ? element.textContent.trim().substring(0, 50)
      : "",
    frameUrl: context?.frame?.url || "",
    frameOrigin: context?.frame?.origin || "",
    frameSelectors: context?.frame?.selectors || [],
    shadowDepth: context?.shadow?.depth || 0,
    shadowTrail: context?.shadow?.hosts || [],
  };
}

function buildContext(element) {
  const frame = getFrameMetadata();
  const shadow = buildShadowContext(element);
  return { frame, shadow };
}

function gatherSelectionData(element) {
  const xpaths = generateXPathOptions(element);
  const context = buildContext(element);
  const elementInfo = buildElementInfo(element, context);
  return { xpaths, context, elementInfo };
}

function getComposedPathTarget(event) {
  const path = event.composedPath?.();
  if (Array.isArray(path)) {
    const firstElement = path.find((node) => node instanceof Element);
    if (firstElement) {
      return firstElement;
    }
  }
  return event.target instanceof Element ? event.target : null;
}

// State management
let highlightedElement = null;
let lastElement = null;
let throttleTimeout = null;
let isExtensionValid = true;
let contextCheckInterval = null;
let lockedElement = null;
let isLocked = false;
let isPanelOpen = false;
let hoverEnabled = false;
let listenersAttached = false;
let hoverPreference = true;

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

  detachHoverListeners();
}

function attachHoverListeners() {
  if (listenersAttached) return;
  document.addEventListener("mouseover", handleMouseOver, { passive: true });
  document.addEventListener("mouseout", handleMouseOut, { passive: true });
  document.addEventListener("click", handleClick, { passive: false });
  document.addEventListener("keydown", handleKeyDown, { passive: false });
  listenersAttached = true;
}

function detachHoverListeners() {
  if (!listenersAttached) return;
  document.removeEventListener("mouseover", handleMouseOver);
  document.removeEventListener("mouseout", handleMouseOut);
  document.removeEventListener("click", handleClick);
  document.removeEventListener("keydown", handleKeyDown);
  listenersAttached = false;
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

// Throttled mouseover handler
function handleMouseOver(event) {
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  if (!isPanelOpen || !hoverEnabled || isLocked) {
    return;
  }

  const element = getComposedPathTarget(event);

  if (!element) {
    return;
  }

  if (element === lastElement || element.id === "pathfinder-x-highlight") {
    return;
  }

  lastElement = element;

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
  }

  highlightElement(element);
  updateHighlightStyle(false);

  throttleTimeout = setTimeout(() => {
    // Verify element is still in the DOM
    if (!element.isConnected) {
      return;
    }

    const payload = gatherSelectionData(element);

    if (!payload || !payload.xpaths || payload.xpaths.length === 0) {
      return;
    }

    const message = {
      type: "XPATH_FOUND",
      xpaths: payload.xpaths,
      elementInfo: payload.elementInfo,
      context: payload.context,
    };

    try {
      chrome.runtime.sendMessage(message, () => {
        // Suppress transient errors — context check interval handles real invalidation
        void chrome.runtime.lastError;
      });
    } catch (error) {
      // Extension context may have been invalidated
    }
  }, 50);
}

function handleMouseOut(event) {
  if (isLocked) return;

  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  if (!isPanelOpen || !hoverEnabled) {
    return;
  }

  // Check if the mouse left the current element (not just moved to a child)
  const relatedTarget = event.relatedTarget;
  if (relatedTarget && lastElement && lastElement.contains(relatedTarget)) {
    return;
  }

  removeHighlight();
  lastElement = null;

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
    throttleTimeout = null;
  }

  try {
    chrome.runtime.sendMessage({ type: "XPATH_CLEAR" }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Extension context may have been invalidated
  }
}

function handleClick(event) {
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  if (!isPanelOpen || !hoverEnabled) {
    return;
  }

  const element = getComposedPathTarget(event);

  if (!element) {
    return;
  }

  if (
    element.tagName === "HTML" ||
    element.tagName === "BODY" ||
    element === document.documentElement ||
    element.id === "pathfinder-x-highlight"
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  lockElement(element);
}

function lockElement(element) {
  if (isLocked) return;

  isLocked = true;
  lockedElement = element;
  hoverEnabled = false;

  highlightElement(lockedElement);
  updateHighlightStyle(true);

  const payload = gatherSelectionData(lockedElement);

  if (!payload || !payload.xpaths || payload.xpaths.length === 0) {
    return;
  }

  const message = {
    type: "XPATH_LOCKED",
    xpaths: payload.xpaths,
    elementInfo: payload.elementInfo,
    context: payload.context,
  };

  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Extension context may have been invalidated
  }

  try {
    chrome.runtime.sendMessage({ type: "LOCK_STATE_SYNC", locked: true });
  } catch (error) {
    // Lock sync failed
  }
}

function handleKeyDown(event) {
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  if (event.code === "Space" && isPanelOpen) {
    event.preventDefault();
    if (isLocked) {
      unlockElement();
    } else if (hoverEnabled && lastElement) {
      lockElement(lastElement);
    }
  }
}

function unlockElement() {
  isLocked = false;
  lockedElement = null;
  lastElement = null;
  removeHighlight();

  try {
    chrome.runtime.sendMessage({ type: "XPATH_UNLOCKED" }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Extension context may have been invalidated
  }

  hoverEnabled = hoverPreference;

  try {
    chrome.runtime.sendMessage({ type: "LOCK_STATE_SYNC", locked: false });
  } catch (error) {
    // Lock sync failed
  }
}

// Listen for messages from side panel and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ success: true });
    return;
  }

  if (message.type === "UNLOCK_ELEMENT") {
    unlockElement();
    sendResponse({ success: true });
  } else if (message.type === "PANEL_OPENED") {
    isPanelOpen = true;
    hoverEnabled = hoverPreference && !isLocked;
    attachHoverListeners();
    sendResponse({ success: true });
  } else if (message.type === "PANEL_CLOSED") {
    isPanelOpen = false;
    hoverEnabled = false;
    if (isLocked) {
      unlockElement();
    }
    removeHighlight();
    lastElement = null;
    detachHoverListeners();
    sendResponse({ success: true });
  } else if (message.type === "ENABLE_HOVER") {
    hoverPreference = true;
    if (!isLocked) {
      hoverEnabled = true;
      isPanelOpen = true;
      attachHoverListeners();
    }
    sendResponse({ success: true });
  } else if (message.type === "DISABLE_HOVER") {
    hoverPreference = false;
    hoverEnabled = false;
    // If locked, fully release the lock so state doesn't go stale
    if (isLocked) {
      isLocked = false;
      lockedElement = null;
    }
    removeHighlight();
    lastElement = null;
    sendResponse({ success: true });
  } else if (message.type === "LOCK_STATE_SYNC") {
    if (message.locked) {
      isLocked = true;
      hoverEnabled = false;
      if (!lockedElement) {
        removeHighlight();
      }
    } else {
      isLocked = false;
      if (!lockedElement) {
        hoverEnabled = hoverPreference;
      }
    }
    sendResponse({ success: true });
  }
});

// Initialize
if (initializeContentScript()) {
  const canUseUnloadHandlers =
    typeof window.fence === "undefined" &&
    !(document && document.fencedframeElement);

  const handleUnload = () => {
    removeHighlight();
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
    }
    detachHoverListeners();
  };

  if (canUseUnloadHandlers) {
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("unload", handleUnload);
  }

  // Check extension context lazily — only when interaction is happening
  // instead of polling every 5 seconds on every page
  contextCheckInterval = setInterval(() => {
    if (!isPanelOpen) return; // Only check when panel is active
    if (!checkExtensionContext()) {
      cleanup();
    }
  }, 10000);
}

} // end double-initialization guard
