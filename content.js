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
    options.push({ type: "Optimized", xpath: optimized, strategy: "xpath" });

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
      options.push({
        type: "Structural",
        xpath: structural,
        strategy: "xpath",
      });
    }

    // Add CSS selector equivalent if useful
    try {
      const cssSelector = getCSSSelector(element);
      console.log("generateXPathOptions: CSS Selector:", cssSelector);
      if (cssSelector && cssSelector.length < 100) {
        options.push({
          type: "CSS Selector",
          xpath: cssSelector,
          strategy: "css",
        });
      }
    } catch (e) {
      console.log("generateXPathOptions: CSS selector generation failed:", e);
    }

    console.log("generateXPathOptions: Final options:", options);
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
    console.error("generateXPathOptions: Error generating XPaths:", error);
    // Return at least one option as fallback
    return [
      { type: "Basic", xpath: getStructuralXPath(element), strategy: "xpath" },
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
        xpath: `//${element.tagName.toLowerCase()}[@${attr}="${value}"]`,
        strategy: "xpath",
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
        strategy: "xpath",
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
      // Only if it's among the first 5
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

function escapeSelector(selector) {
  if (!selector) {
    return "";
  }
  return selector.replace(/'/g, "\\'");
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
    const normalized = escapeSelector(step.selector);
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
    return `${frameEl.tagName.toLowerCase()}[name="${frameEl.name}"]`;
  }

  const src = frameEl.getAttribute("src");
  if (src) {
    return `${frameEl.tagName.toLowerCase()}[src="${src}"]`;
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

  return {
    xpaths,
    context,
    elementInfo,
  };
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

function escapeForXPathLiteral(value) {
  if (value == null) {
    return "";
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  const parts = value.split('"').map((part) => `"${part}"`);
  const joined = parts.join(", '"', ");
  return `concat(${joined})`;
}

function getSiblingIndex(element) {
  if (!element || !element.parentElement) {
    return 1;
  }
  const siblings = Array.from(element.parentElement.children).filter(
    (child) => child.tagName === element.tagName
  );
  return siblings.indexOf(element) + 1;
}

function buildElementPredicate(element) {
  if (!element) {
    return null;
  }

  if (
    element.id &&
    document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
  ) {
    return `@id=${escapeForXPathLiteral(element.id)}`;
  }

  const testAttributes = [
    "data-testid",
    "data-test",
    "data-cy",
    "data-qa",
    "name",
    "type",
    "aria-label",
    "title",
    "alt",
    "placeholder",
  ];

  for (const attr of testAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      const selector = `[${attr}="${CSS.escape(value)}"]`;
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return `@${attr}=${escapeForXPathLiteral(value)}`;
        }
      } catch (error) {
        // Ignore selector errors and continue
      }
    }
  }

  const textContent = element.textContent?.trim();
  if (textContent && textContent.length >= 3 && textContent.length <= 40) {
    const normalized = textContent.replace(/\s+/g, " ");
    return `contains(normalize-space(.), ${escapeForXPathLiteral(normalized)})`;
  }

  if (element.className && typeof element.className === "string") {
    const classes = element.className.trim().split(/\s+/).filter(Boolean);
    const meaningful = classes.find(
      (cls) =>
        cls.length > 3 &&
        !cls.match(/^(d-|flex-|text-|bg-|border-|p-|m-|col-|row-)/)
    );
    if (meaningful) {
      return `contains(@class, ${escapeForXPathLiteral(meaningful)})`;
    }
  }

  if (element.parentElement) {
    const index = getSiblingIndex(element);
    if (index > 0) {
      return `position()=${index}`;
    }
  }

  return null;
}

function buildStructuralPathFromAncestor(ancestor, descendant) {
  if (!ancestor || !descendant) {
    return "";
  }
  const segments = [];
  let current = descendant;

  while (current && current !== ancestor) {
    const parent = current.parentElement;
    if (!parent) {
      break;
    }

    let segment = `/${current.tagName.toLowerCase()}`;
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === current.tagName
    );
    if (siblings.length > 1) {
      segment += `[${siblings.indexOf(current) + 1}]`;
    }

    segments.unshift(segment);
    current = parent;
  }

  return segments.join("");
}

function generateRelationOptions(anchorElement, targetElement, anchorData, targetData) {
  if (!anchorElement || !targetElement) {
    return [];
  }

  const optionsMap = new Map();
  const anchorPrimary =
    anchorData?.xpaths?.[0]?.xpath || getStructuralXPath(anchorElement);
  const targetPrimary =
    targetData?.xpaths?.[0]?.xpath || getStructuralXPath(targetElement);

  if (!anchorPrimary) {
    return [];
  }

  const predicate = buildElementPredicate(targetElement);
  const predicateSuffix = predicate ? `[${predicate}]` : "";
  const targetTag = targetElement.tagName.toLowerCase();

  const addOption = (type, axisExpression, note = "") => {
    if (!axisExpression) {
      return;
    }
    const xpath = `(${anchorPrimary})${axisExpression}`.replace(/\s+/g, " ").trim();
    if (!optionsMap.has(xpath)) {
      optionsMap.set(xpath, {
        type,
        xpath,
        note,
        strategy: "xpath",
      });
    }
  };

  if (anchorElement.contains(targetElement)) {
    if (predicateSuffix) {
      addOption(
        "Descendant",
        `//${targetTag}${predicateSuffix}`,
        "Target is inside the anchor subtree"
      );
    }
    const structural = buildStructuralPathFromAncestor(anchorElement, targetElement);
    if (structural) {
      addOption(
        "Descendant structural",
        structural,
        "Precise structural path from anchor to target"
      );
    }
  }

  if (targetElement.contains(anchorElement)) {
    addOption(
      "Ancestor",
      `/ancestor::${targetTag}${predicateSuffix}`,
      "Target wraps the anchor element"
    );
  }

  const anchorParent = anchorElement.parentElement;
  const targetParent = targetElement.parentElement;
  if (anchorParent && anchorParent === targetParent) {
    const anchorIndex = getSiblingIndex(anchorElement);
    const targetIndex = getSiblingIndex(targetElement);
    const siblingPredicate = predicateSuffix || `[position()=${targetIndex}]`;

    if (targetIndex < anchorIndex) {
      addOption(
        "Preceding sibling",
        `/preceding-sibling::${targetTag}${siblingPredicate}`,
        "Target is a preceding sibling of anchor"
      );
    } else if (targetIndex > anchorIndex) {
      addOption(
        "Following sibling",
        `/following-sibling::${targetTag}${siblingPredicate}`,
        "Target is a following sibling of anchor"
      );
    }
  }

  const position = anchorElement.compareDocumentPosition(targetElement);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    addOption(
      "Following",
      `/following::${targetTag}${predicateSuffix}`,
      "Target appears after anchor in document flow"
    );
  }
  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    addOption(
      "Preceding",
      `/preceding::${targetTag}${predicateSuffix}`,
      "Target appears before anchor in document flow"
    );
  }

  if (predicateSuffix) {
    addOption(
      "Ancestor search",
      `/ancestor-or-self::*//${targetTag}${predicateSuffix}`,
      "Search anchor and its ancestors for the target"
    );
  }

  if (optionsMap.size === 0 && targetPrimary) {
    optionsMap.set(targetPrimary, {
      type: "Target selector",
      xpath: targetPrimary,
      note: "Fallback to direct target selector",
      strategy: "xpath",
    });
  }

  return Array.from(optionsMap.values()).slice(0, 6);
}

function buildRelationStatePayload() {
  return {
    mode: interactionMode,
    anchor: relationState.anchorData,
    target: relationState.targetData,
    relations: relationState.relations,
  };
}

function broadcastRelationState() {
  const state = buildRelationStatePayload();
  try {
    chrome.runtime.sendMessage({
      type: "RELATION_STATE_UPDATE",
      state,
    });
  } catch (error) {
    console.log("Content script: Failed to broadcast relation state", error);
  }
}

function clearRelationSelection(notify = true) {
  relationState.anchorElement = null;
  relationState.targetElement = null;
  relationState.anchorData = null;
  relationState.targetData = null;
  relationState.relations = [];
  hideAnchorHighlight();
  hideTargetHighlight();
  removeHighlight();
  if (notify) {
    broadcastRelationState();
  }
}

function setRelationAnchor(element) {
  relationState.anchorElement = element;
  relationState.targetElement = null;
  relationState.anchorData = gatherSelectionData(element);
  relationState.targetData = null;
  relationState.relations = [];
  showAnchorHighlight(element);
  hideTargetHighlight();
  removeHighlight();
  broadcastRelationState();
}

function setRelationTarget(element) {
  relationState.targetElement = element;
  relationState.targetData = gatherSelectionData(element);
  relationState.relations = generateRelationOptions(
    relationState.anchorElement,
    element,
    relationState.anchorData,
    relationState.targetData
  );
  showTargetHighlight(element);
  broadcastRelationState();
}

function handleRelationClick(element) {
  if (!relationState.anchorElement) {
    setRelationAnchor(element);
    return;
  }

  if (!relationState.targetElement) {
    if (relationState.anchorElement === element) {
      return;
    }
    setRelationTarget(element);
    return;
  }

  if (relationState.anchorElement === element) {
    return;
  }

  setRelationTarget(element);
}

function setInteractionMode(mode) {
  const normalized =
    mode === InteractionModes.RELATION
      ? InteractionModes.RELATION
      : InteractionModes.STANDARD;

  const previousMode = interactionMode;
  interactionMode = normalized;
  hoverEnabled = hoverPreference && !isLocked;

  if (normalized === InteractionModes.STANDARD) {
    if (previousMode === InteractionModes.RELATION) {
      clearRelationSelection(true);
    }
  } else {
    if (previousMode === InteractionModes.STANDARD) {
      removeHighlight();
    }
  }
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
let hoverPreference = true; // Track desired hover state from popup toggle

const InteractionModes = {
  STANDARD: "standard",
  RELATION: "relation",
};

let interactionMode = InteractionModes.STANDARD;

const relationState = {
  anchorElement: null,
  targetElement: null,
  anchorData: null,
  targetData: null,
  relations: [],
  anchorOverlay: null,
  targetOverlay: null,
};

// Cleanup function to remove event listeners and highlights
function cleanup() {
  isExtensionValid = false;
  clearRelationSelection(false);
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

function positionOverlay(overlay, element) {
  if (!overlay || !element) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  overlay.style.top = rect.top + scrollTop + "px";
  overlay.style.left = rect.left + scrollLeft + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.display = "block";
}

function ensureAnchorOverlay() {
  if (relationState.anchorOverlay && document.body.contains(relationState.anchorOverlay)) {
    return relationState.anchorOverlay;
  }

  const overlay = document.createElement("div");
  overlay.id = "pathfinder-x-anchor-highlight";
  overlay.style.cssText = `
    position: absolute;
    background: rgba(63, 81, 181, 0.2);
    border: 2px dashed #3f51b5;
    pointer-events: none;
    z-index: 999998;
    box-sizing: border-box;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);
  relationState.anchorOverlay = overlay;
  return overlay;
}

function updateAnchorOverlayPosition() {
  if (relationState.anchorElement && relationState.anchorOverlay) {
    positionOverlay(relationState.anchorOverlay, relationState.anchorElement);
  }
}

function showAnchorHighlight(element) {
  const overlay = ensureAnchorOverlay();
  positionOverlay(overlay, element);
}

function hideAnchorHighlight() {
  if (relationState.anchorOverlay) {
    relationState.anchorOverlay.style.display = "none";
  }
}

function ensureTargetOverlay() {
  if (relationState.targetOverlay && document.body.contains(relationState.targetOverlay)) {
    return relationState.targetOverlay;
  }

  const overlay = document.createElement("div");
  overlay.id = "pathfinder-x-target-highlight";
  overlay.style.cssText = `
    position: absolute;
    background: rgba(0, 150, 136, 0.18);
    border: 2px solid #009688;
    pointer-events: none;
    z-index: 999997;
    box-sizing: border-box;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);
  relationState.targetOverlay = overlay;
  return overlay;
}

function updateTargetOverlayPosition() {
  if (relationState.targetElement && relationState.targetOverlay) {
    positionOverlay(relationState.targetOverlay, relationState.targetElement);
  }
}

function showTargetHighlight(element) {
  const overlay = ensureTargetOverlay();
  positionOverlay(overlay, element);
}

function hideTargetHighlight() {
  if (relationState.targetOverlay) {
    relationState.targetOverlay.style.display = "none";
  }
}

window.addEventListener("scroll", () => {
  updateAnchorOverlayPosition();
  updateTargetOverlayPosition();
}, true);
window.addEventListener("resize", () => {
  updateAnchorOverlayPosition();
  updateTargetOverlayPosition();
});

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

  positionOverlay(highlightedElement, element);
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

  const element = getComposedPathTarget(event);

  if (!element) {
    return;
  }

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
    const payload = gatherSelectionData(element);
    console.log("Content script generated payload:", payload);

    if (!payload || !payload.xpaths || payload.xpaths.length === 0) {
      console.error("Content script: No XPath options generated!");
      return;
    }

    const message = {
      type: "XPATH_FOUND",
      xpaths: payload.xpaths,
      elementInfo: payload.elementInfo,
      context: payload.context,
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
  if (!isPopupOpen || (!hoverEnabled && interactionMode !== InteractionModes.RELATION)) {
    return;
  }

  const element = getComposedPathTarget(event);

  if (!element) {
    return;
  }

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

  if (interactionMode === InteractionModes.RELATION) {
    handleRelationClick(element);
    return;
  }

  // Lock the element
  lockElement(element);
}

// Add a new function to handle locking the element
function lockElement(element) {
  if (isLocked) return; // Already locked

  isLocked = true;
  lockedElement = element;
  hoverEnabled = false;

  // Highlight the locked element
  highlightElement(lockedElement);
  updateHighlightStyle(true); // Use locked style

  const payload = gatherSelectionData(lockedElement);
  console.log("Content script: Element locked", lockedElement);
  console.log("Content script generated payload for locked element:", payload);

  if (!payload || !payload.xpaths || payload.xpaths.length === 0) {
    console.error(
      "Content script: No XPath options generated for locked element!"
    );
    return;
  }

  const message = {
    type: "XPATH_LOCKED",
    xpaths: payload.xpaths,
    elementInfo: payload.elementInfo,
    context: payload.context,
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

  try {
    chrome.runtime.sendMessage({ type: "LOCK_STATE_SYNC", locked: true });
  } catch (error) {
    console.log("Content script: Failed to sync lock state", error);
  }
}

// Add a new function to handle keydown events for locking
function handleKeyDown(event) {
  // Check if extension is still valid
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }

  if (interactionMode === InteractionModes.RELATION) {
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
  hoverEnabled = hoverPreference;
  console.log("Content script: Element unlocked, hover detection re-enabled");

  try {
    chrome.runtime.sendMessage({ type: "LOCK_STATE_SYNC", locked: false });
  } catch (error) {
    console.log("Content script: Failed to broadcast unlock state", error);
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "UNLOCK_ELEMENT") {
    unlockElement();
    sendResponse({ success: true });
  } else if (message.type === "POPUP_OPENED") {
    isPopupOpen = true;
    // Enable hover by default when popup opens (will be disabled if toggle is off)
    hoverEnabled = hoverPreference && !isLocked;
    attachHoverListeners();
    console.log(
      "Content script: Popup opened, listeners attached, hover enabled"
    );
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
    isPopupOpen = true;
    if (!listenersAttached) {
      attachHoverListeners();
    }
    hoverPreference = true;
    if (!isLocked) {
      hoverEnabled = true;
    }
    console.log("Content script: Hover detection enabled");
    sendResponse({ success: true });
  } else if (message.type === "DISABLE_HOVER") {
    isPopupOpen = true;
    hoverPreference = false;
    hoverEnabled = false;
    removeHighlight();
    lastElement = null;
    console.log("Content script: Hover detection disabled");
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
  } else if (message.type === "SET_INTERACTION_MODE") {
    setInteractionMode(message.mode);
    sendResponse({ success: true });
  } else if (message.type === "RELATION_CLEAR") {
    clearRelationSelection(true);
    sendResponse({ success: true });
  }
});

// Initialize the extension if context is valid
if (initializeContentScript()) {
  // Do NOT attach hover listeners yet; wait for popup to open

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
  } else {
    console.log(
      "Pathfinder-X: Skipping unload handlers due to fenced frame restrictions"
    );
  }

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
