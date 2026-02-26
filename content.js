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
  // String contains both quote types — build a flat concat() expression
  const segments = [];
  const parts = str.split('"');
  parts.forEach((part, i) => {
    if (i > 0) segments.push("'\"'");
    if (part) segments.push(`"${part}"`);
  });
  return `concat(${segments.join(",")})`;
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

function isUniqueSelector(option) {
  try {
    if (option.strategy === "shadow") return true;
    if (option.strategy === "css") {
      return _activeDoc.querySelectorAll(option.xpath).length === 1;
    }
    return isUniqueXPath(option.xpath);
  } catch (e) {
    return false;
  }
}

function filterUniqueOptions(options) {
  const unique = options.filter(isUniqueSelector);
  // Always return at least the structural/first option so the card isn't empty
  return unique.length > 0 ? unique : options.slice(0, 1);
}

// Generate multiple XPath options
function generateXPathOptions(element) {

  const options = [];

  try {
    const optimized = getOptimizedXPathV2(element);
    options.push({ type: "Optimized", xpath: optimized, strategy: "xpath" });

    const alternatives = generateAlternativeXPathsV2(element);
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

    const filtered = filterUniqueOptions(options);

    if (filtered.length > 5) {
      const shadowOption = filtered.find((opt) => opt.strategy === "shadow");
      if (shadowOption) {
        const trimmed = filtered
          .filter((opt) => opt.strategy !== "shadow")
          .slice(0, 4);
        trimmed.push(shadowOption);
        return trimmed;
      }
      return filtered.slice(0, 5);
    }

    return filtered;
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

// --- Shared helpers ---

function isUniqueXPath(xpath) {
  try {
    return _activeDoc.evaluate(
      xpath, _activeDoc, null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    ).snapshotLength === 1;
  } catch (e) {
    return false;
  }
}

const DYNAMIC_ID_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^:r[0-9a-z]+:$/,
  /^(ember|react-select-|__next-|radix-)\d/,
  /^[a-zA-Z_-]*[0-9]{5,}$/,
  /^[a-z]{1,3}-[0-9a-f]{6,}$/i,
  /^[a-z]+_[A-Za-z0-9+/=]{8,}$/,
];

function isStableId(id) {
  if (!id || id.length < 2) return false;
  return !DYNAMIC_ID_PATTERNS.some(pattern => pattern.test(id));
}

const TEST_ATTRIBUTES_V2 = [
  "data-testid", "data-test", "data-cy", "data-qa", "data-automation"
];
const TEST_ATTR_SET = new Set(TEST_ATTRIBUTES_V2);

const IGNORE_DATA_PATTERNS = [
  /^data-reactid$/,
  /^data-react/,
  /^data-v-/,
  /^data-emotion/,
  /^data-styled/,
  /^data-radix/,
  /^data-headlessui/,
  /^data-rbd/,
];

function isSemanticDataAttr(attrName) {
  if (!attrName.startsWith("data-")) return false;
  if (TEST_ATTR_SET.has(attrName)) return false;
  return !IGNORE_DATA_PATTERNS.some(p => p.test(attrName));
}

function getMeaningfulClasses(element) {
  if (!element.className || typeof element.className !== "string") return [];
  return element.className.trim().split(/\s+/).filter(cls =>
    cls.length > 2 &&
    !cls.match(/^(d-|flex-|text-|bg-|border-|p-|m-|col-|row-|w-|h-|gap-|grid-|justify-|items-|self-|btn-secondary|btn-primary)/) &&
    !cls.match(/^[a-z]{1,2}$/) &&
    !cls.match(/^[a-f0-9]{6,}$/i)
  );
}

function findStableAnchor(element) {
  let current = element.parentElement;
  let depth = 0;
  const MAX_DEPTH = 6;

  while (current && current !== _activeDoc.body && depth < MAX_DEPTH) {
    depth++;

    if (current.id && isStableId(current.id)) {
      const escaped = CSS.escape(current.id);
      if (_activeDoc.querySelectorAll(`#${escaped}`).length === 1) {
        return { element: current, xpath: `//*[@id=${escapeXPathString(current.id)}]`, depth };
      }
    }

    for (const attr of TEST_ATTRIBUTES_V2) {
      const val = current.getAttribute(attr);
      if (val) {
        const anchorXpath = `//*[@${attr}=${escapeXPathString(val)}]`;
        if (isUniqueXPath(anchorXpath)) {
          return { element: current, xpath: anchorXpath, depth };
        }
      }
    }

    const role = current.getAttribute("role");
    if (role) {
      const anchorXpath = `//*[@role=${escapeXPathString(role)}]`;
      if (isUniqueXPath(anchorXpath)) {
        return { element: current, xpath: anchorXpath, depth };
      }
    }

    const name = current.getAttribute("name");
    if (name) {
      const anchorXpath = `//${current.tagName.toLowerCase()}[@name=${escapeXPathString(name)}]`;
      if (isUniqueXPath(anchorXpath)) {
        return { element: current, xpath: anchorXpath, depth };
      }
    }

    current = current.parentElement;
  }

  return null;
}

function buildRelativePath(fromAncestor, toElement) {
  const path = [];
  let current = toElement;

  while (current && current !== fromAncestor) {
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children).filter(
      child => child.tagName === current.tagName
    );
    let step = current.tagName.toLowerCase();
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      step += `[${index}]`;
    }
    path.unshift(step);
    current = parent;
  }

  return path.join("/");
}

function getOptimizedXPathV2(element) {
  const tag = element.tagName.toLowerCase();

  // Priority 1: Stable ID
  if (element.id) {
    const escaped = CSS.escape(element.id);
    if (
      isStableId(element.id) &&
      _activeDoc.querySelectorAll(`#${escaped}`).length === 1
    ) {
      return `//*[@id=${escapeXPathString(element.id)}]`;
    }
  }

  // Priority 2: Name + type combination (form elements)
  if (FORM_TAGS.has(element.tagName)) {
    const name = element.getAttribute("name");
    const type = element.getAttribute("type");

    if (name && type) {
      const xpath = `//${tag}[@name=${escapeXPathString(name)} and @type=${escapeXPathString(type)}]`;
      if (isUniqueXPath(xpath)) return xpath;
    }

    if (name) {
      const xpath = `//${tag}[@name=${escapeXPathString(name)}]`;
      if (isUniqueXPath(xpath)) return xpath;
    }
  }

  // Priority 3: ARIA role (elevated — spec-driven, never localized)
  const role = element.getAttribute("role");
  if (role) {
    const xpath = `//*[@role=${escapeXPathString(role)}]`;
    if (isUniqueXPath(xpath)) return xpath;

    const tagXpath = `//${tag}[@role=${escapeXPathString(role)}]`;
    if (isUniqueXPath(tagXpath)) return tagXpath;
  }

  // Priority 4: Test attributes (with uniqueness check)
  for (const attr of TEST_ATTRIBUTES_V2) {
    const value = element.getAttribute(attr);
    if (value) {
      const xpath = `//*[@${attr}=${escapeXPathString(value)}]`;
      if (isUniqueXPath(xpath)) return xpath;
    }
  }

  // Priority 5: Semantic data-* attributes
  const dataAttrs = Array.from(element.attributes)
    .filter(a => isSemanticDataAttr(a.name) && a.value && a.value.length < 80)
    .sort((a, b) => a.value.length - b.value.length);

  for (const attr of dataAttrs) {
    const xpath = `//*[@${attr.name}=${escapeXPathString(attr.value)}]`;
    if (isUniqueXPath(xpath)) return xpath;
  }

  // Priority 6: Multi-condition attribute triangulation
  const STABLE_ATTRS = [
    "name", "type", "role", "aria-label",
    "placeholder", "title", "alt", "href", "for"
  ];

  const presentAttrs = STABLE_ATTRS
    .map(attr => ({ name: attr, value: element.getAttribute(attr) }))
    .filter(a => a.value && a.value.length < 60);

  dataAttrs.forEach(a => {
    if (presentAttrs.length < 8) {
      presentAttrs.push({ name: a.name, value: a.value });
    }
  });

  // Try pairs
  if (presentAttrs.length >= 2) {
    for (let i = 0; i < presentAttrs.length - 1; i++) {
      for (let j = i + 1; j < presentAttrs.length; j++) {
        const a = presentAttrs[i];
        const b = presentAttrs[j];
        const xpath = `//${tag}[@${a.name}=${escapeXPathString(a.value)} and @${b.name}=${escapeXPathString(b.value)}]`;
        if (isUniqueXPath(xpath)) return xpath;
      }
    }
  }

  // Try triples
  if (presentAttrs.length >= 3) {
    for (let i = 0; i < presentAttrs.length - 2; i++) {
      for (let j = i + 1; j < presentAttrs.length - 1; j++) {
        for (let k = j + 1; k < presentAttrs.length; k++) {
          const a = presentAttrs[i];
          const b = presentAttrs[j];
          const c = presentAttrs[k];
          const xpath = `//${tag}[@${a.name}=${escapeXPathString(a.value)} and @${b.name}=${escapeXPathString(b.value)} and @${c.name}=${escapeXPathString(c.value)}]`;
          if (isUniqueXPath(xpath)) return xpath;
        }
      }
    }
  }

  // Priority 7: Meaningful class + attribute
  const meaningfulClasses = getMeaningfulClasses(element);

  for (const cls of meaningfulClasses.slice(0, 3)) {
    for (const attr of presentAttrs.slice(0, 3)) {
      const xpath = `//${tag}[contains(@class,${escapeXPathString(cls)}) and @${attr.name}=${escapeXPathString(attr.value)}]`;
      if (isUniqueXPath(xpath)) return xpath;
    }

    const xpath = `//${tag}[contains(@class,${escapeXPathString(cls)})]`;
    if (isUniqueXPath(xpath)) return xpath;
  }

  // Priority 8: Scoped structural with stable anchor
  const anchor = findStableAnchor(element);
  if (anchor) {
    const relativePath = buildRelativePath(anchor.element, element);
    if (relativePath) {
      const xpath = `${anchor.xpath}/${relativePath}`;
      if (isUniqueXPath(xpath)) return xpath;
    }

    const descXpath = `${anchor.xpath}//${tag}`;
    if (isUniqueXPath(descXpath)) return descXpath;
  }

  // Priority 9: Complex predicates — text content
  if (["A", "BUTTON", "SPAN", "LABEL", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH"].includes(element.tagName)) {
    const text = element.textContent?.trim();
    if (text && text.length > 2 && text.length < 50) {
      const xpath = `//${tag}[normalize-space(text())=${escapeXPathString(text)}]`;
      if (isUniqueXPath(xpath)) return xpath;

      const containsXpath = `//${tag}[contains(normalize-space(.),${escapeXPathString(text)})]`;
      if (isUniqueXPath(containsXpath)) return containsXpath;
    }
  }

  // Priority 9b: Label-relative selectors for form inputs
  if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) {
    const prevLabel = element.previousElementSibling;
    if (prevLabel && prevLabel.tagName === "LABEL" && prevLabel.textContent?.trim()) {
      const labelText = prevLabel.textContent.trim();
      if (labelText.length < 40) {
        const xpath = `//label[normalize-space(.)=${escapeXPathString(labelText)}]/following-sibling::${tag}[1]`;
        if (isUniqueXPath(xpath)) return xpath;
      }
    }

    if (element.id) {
      const label = _activeDoc.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label && label.textContent?.trim()) {
        const labelText = label.textContent.trim();
        const xpath = `//label[normalize-space(.)=${escapeXPathString(labelText)}]/following::${tag}[1]`;
        if (isUniqueXPath(xpath)) return xpath;
      }
    }
  }

  // Priority 10: Full structural fallback
  return getStructuralXPath(element);
}

function generateAlternativeXPathsV2(element) {
  const alternatives = [];
  const tag = element.tagName.toLowerCase();

  // Alt 1: By aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.length < 60) {
    alternatives.push({
      type: "By aria-label",
      xpath: `//${tag}[@aria-label=${escapeXPathString(ariaLabel)}]`,
      strategy: "xpath",
    });
  }

  // Alt 2: By semantic data-* attribute
  const dataAttr = Array.from(element.attributes).find(
    a => isSemanticDataAttr(a.name) && a.value
  );
  if (dataAttr) {
    alternatives.push({
      type: `By ${dataAttr.name}`,
      xpath: `//*[@${dataAttr.name}=${escapeXPathString(dataAttr.value)}]`,
      strategy: "xpath",
    });
  }

  // Alt 3: Scoped path
  const anchor = findStableAnchor(element);
  if (anchor) {
    const relPath = buildRelativePath(anchor.element, element);
    if (relPath) {
      alternatives.push({
        type: "Scoped path",
        xpath: `${anchor.xpath}/${relPath}`,
        strategy: "xpath",
      });
    }
  }

  // Alt 4: By text content
  const text = element.textContent?.trim();
  if (text && text.length > 2 && text.length < 40) {
    alternatives.push({
      type: "By text",
      xpath: `//${tag}[contains(normalize-space(.),${escapeXPathString(text)})]`,
      strategy: "xpath",
    });
  }

  // Alt 5: By position (interactive elements)
  if (["INPUT", "BUTTON", "SELECT", "A"].includes(element.tagName)) {
    const similarElements = _activeDoc.querySelectorAll(tag);
    const position = Array.from(similarElements).indexOf(element) + 1;
    if (position > 0 && position <= 5) {
      alternatives.push({
        type: "By position",
        xpath: `(//${tag})[${position}]`,
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
    current !== _activeDoc.body
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
    // Escape for safe embedding inside a JS single-quoted string
    const normalized = step.selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
    // Display-only string — use CSS-style quoting, not XPath escaping
    const nameVal = frameEl.name.includes('"') ? `'${frameEl.name}'` : `"${frameEl.name}"`;
    return `${frameEl.tagName.toLowerCase()}[name=${nameVal}]`;
  }

  const src = frameEl.getAttribute("src");
  if (src) {
    // Display-only string — use CSS-style quoting, not XPath escaping
    const srcVal = src.includes('"') ? `'${src}'` : `"${src}"`;
    return `${frameEl.tagName.toLowerCase()}[src=${srcVal}]`;
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
      ? element.textContent.trim().replace(/\s+/g, " ").substring(0, 50)
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

function buildPeekContext(element, iframeEl) {
  const iframeDoc = iframeEl.contentDocument;
  const frame = {
    isTopFrame: false,
    url: iframeDoc?.URL || iframeEl.src || "",
    origin: "",
    selectors: [describeFrameElement(iframeEl)].filter(Boolean),
    peekThrough: true,
  };

  try {
    frame.origin = iframeDoc?.location?.origin || "";
  } catch (e) {
    // Cross-origin location access
  }

  // If the parent frame itself is nested, prepend parent's frame selectors
  const parentFrameMeta = getFrameMetadata();
  if (!parentFrameMeta.isTopFrame) {
    frame.selectors = [...parentFrameMeta.selectors, ...frame.selectors];
    if (!frame.origin) {
      frame.origin = parentFrameMeta.origin;
    }
  }

  const shadow = buildShadowContext(element);
  return { frame, shadow };
}

function gatherSelectionData(element, iframeEl) {
  const context = iframeEl
    ? buildPeekContext(element, iframeEl)
    : buildContext(element);
  const elementInfo = buildElementInfo(element, context);
  const elementDoc = element.ownerDocument || document;

  const generate = () => {
    const xpaths = generateXPathOptions(element);
    return { xpaths, context, elementInfo };
  };

  // If the element is from a different document (iframe peek-through),
  // run XPath generation against that document.
  if (elementDoc !== document) {
    return withDocument(elementDoc, generate);
  }
  return generate();
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

// Bubble up from generic wrappers (div, span, svg, etc.) to the nearest
// semantic/interactive parent so selectors target the meaningful element
// (e.g. <button> instead of its inner <div>).
const SEMANTIC_TARGETS = new Set([
  "A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL",
  "SUMMARY", "OPTION", "DETAILS",
]);

const INTERACTIVE_ROLES = new Set([
  "button", "link", "menuitem", "tab", "option",
  "checkbox", "radio", "switch", "combobox",
]);

const WRAPPER_TAGS = new Set([
  "DIV", "SPAN", "SVG", "PATH", "G", "IMG", "I",
  "EM", "STRONG", "B", "P", "SMALL",
]);

const FORM_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON"]);

function resolveSmartTarget(element) {
  if (SEMANTIC_TARGETS.has(element.tagName)) return element;

  const role = element.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return element;

  if (!WRAPPER_TAGS.has(element.tagName)) return element;

  let current = element.parentElement;
  let depth = 0;

  while (current && current !== (element.ownerDocument || document).body && depth < 3) {
    if (SEMANTIC_TARGETS.has(current.tagName)) return current;

    const parentRole = current.getAttribute("role");
    if (parentRole && INTERACTIVE_ROLES.has(parentRole)) return current;

    // Stop at non-wrapper elements — don't skip past meaningful containers
    if (!WRAPPER_TAGS.has(current.tagName)) break;

    current = current.parentElement;
    depth++;
  }

  return element;
}

// Active document context for XPath generation.
// Defaults to the current frame's document but is temporarily switched
// when inspecting elements inside an iframe via peek-through overlays.
let _activeDoc = document;

function withDocument(doc, fn) {
  const prev = _activeDoc;
  _activeDoc = doc;
  try {
    return fn();
  } finally {
    _activeDoc = prev;
  }
}

// State management
let highlightedElement = null;
let lastElement = null;
let lastIframeEl = null;
let throttleTimeout = null;
let isExtensionValid = true;
let contextCheckInterval = null;
let lockedElement = null;
let lockedIframeEl = null;
let isLocked = false;
let isPanelOpen = false;
let hoverEnabled = false;
let listenersAttached = false;
let hoverPreference = true;

// Iframe peek-through overlay tracking
let iframeOverlays = [];
let iframeMutationObserver = null;
let _repositionRafId = null;
// Tracks iframes that have a pending load listener so we don't double-attach.
const iframeLoadListened = new WeakSet();

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

  createIframeOverlays();
  startIframeObserver();
  window.addEventListener("scroll", repositionAllIframeOverlays, { passive: true });
  window.addEventListener("resize", repositionAllIframeOverlays, { passive: true });
}

function detachHoverListeners() {
  if (!listenersAttached) return;
  document.removeEventListener("mouseover", handleMouseOver);
  document.removeEventListener("mouseout", handleMouseOut);
  document.removeEventListener("click", handleClick);
  document.removeEventListener("keydown", handleKeyDown);
  listenersAttached = false;

  removeIframeOverlays();
  stopIframeObserver();
  window.removeEventListener("scroll", repositionAllIframeOverlays);
  window.removeEventListener("resize", repositionAllIframeOverlays);
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

// --- Iframe peek-through overlay system ---

function isIframeAccessible(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return false;
    void doc.documentElement;
    return true;
  } catch (e) {
    return false;
  }
}

function positionOverlayOnIframe(overlay, iframe) {
  const rect = iframe.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  // Overlays are position:absolute children of document.body. If body or an
  // ancestor has a CSS transform or non-static position the offsets will be
  // relative to that ancestor rather than the viewport, causing misalignment.
  // This is an accepted edge-case limitation for extension-injected overlays.
  overlay.style.top = (rect.top + scrollTop) + "px";
  overlay.style.left = (rect.left + scrollLeft) + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
}

function attachIframeLoadListener(iframe) {
  if (iframeLoadListened.has(iframe)) return;
  iframeLoadListened.add(iframe);
  iframe.addEventListener("load", () => {
    iframeLoadListened.delete(iframe);
    createIframeOverlays();
  }, { once: true });
}

function createIframeOverlays() {
  removeIframeOverlays();

  const iframes = document.querySelectorAll("iframe");

  iframes.forEach((iframe) => {
    if (!isIframeAccessible(iframe)) {
      // Iframe not yet loaded or cross-origin — watch for load so we can
      // create an overlay once the same-origin content becomes accessible.
      attachIframeLoadListener(iframe);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "pathfinder-x-iframe-overlay";
    overlay.style.cssText = `
      position: absolute;
      background: transparent;
      border: none;
      pointer-events: auto;
      z-index: 999998;
      box-sizing: border-box;
      cursor: default;
    `;

    positionOverlayOnIframe(overlay, iframe);
    document.body.appendChild(overlay);

    overlay.addEventListener("mousemove", (e) => handleIframeMouseMove(e, iframe));
    overlay.addEventListener("click", (e) => handleIframeClick(e, iframe));
    overlay.addEventListener("mouseleave", (e) => handleIframeMouseLeave(e, iframe));

    iframeOverlays.push({ overlay, iframe });
  });
}

function removeIframeOverlays() {
  iframeOverlays.forEach(({ overlay }) => {
    overlay.remove();
  });
  iframeOverlays = [];
}

function repositionAllIframeOverlays() {
  if (_repositionRafId !== null) return;
  _repositionRafId = requestAnimationFrame(() => {
    _repositionRafId = null;
    iframeOverlays.forEach(({ overlay, iframe }) => {
      if (iframe.isConnected) {
        positionOverlayOnIframe(overlay, iframe);
      }
    });
  });
}

// Compute the CSS transform scale factor between the iframe's layout size
// and its visual (rendered) size. This handles cases where a parent applies
// transform: scale() to fit the iframe into a smaller viewing area.
function getIframeScale(iframe) {
  const iframeRect = iframe.getBoundingClientRect();
  const layoutWidth = iframe.offsetWidth;
  const layoutHeight = iframe.offsetHeight;

  if (layoutWidth === 0 || layoutHeight === 0) return { x: 1, y: 1 };

  return {
    x: iframeRect.width / layoutWidth,
    y: iframeRect.height / layoutHeight,
  };
}

function getIframeRelativeCoords(event, iframe) {
  const iframeRect = iframe.getBoundingClientRect();
  const scale = getIframeScale(iframe);
  const style = window.getComputedStyle(iframe);
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;

  // Convert from parent visual coords to iframe's internal layout coords
  return {
    x: (event.clientX - iframeRect.left) / scale.x - borderLeft - paddingLeft,
    y: (event.clientY - iframeRect.top) / scale.y - borderTop - paddingTop,
  };
}

function highlightElementInIframe(element, iframe) {
  if (!highlightedElement) {
    highlightedElement = createHighlightOverlay();
  }

  const elemRect = element.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const scale = getIframeScale(iframe);

  const style = window.getComputedStyle(iframe);
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;

  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  // elemRect is in the iframe's internal (layout) space.
  // Scale border/padding/element offsets to the parent's visual space.
  highlightedElement.style.top =
    (iframeRect.top + (borderTop + paddingTop + elemRect.top) * scale.y + scrollTop) + "px";
  highlightedElement.style.left =
    (iframeRect.left + (borderLeft + paddingLeft + elemRect.left) * scale.x + scrollLeft) + "px";
  highlightedElement.style.width = (elemRect.width * scale.x) + "px";
  highlightedElement.style.height = (elemRect.height * scale.y) + "px";
  highlightedElement.style.display = "block";
}

function handleIframeMouseMove(event, iframe) {
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }
  if (!isPanelOpen || !hoverEnabled || isLocked) return;

  const coords = getIframeRelativeCoords(event, iframe);
  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) return;

  const rawElement = iframeDoc.elementFromPoint(coords.x, coords.y);
  if (!rawElement) return;

  const element = resolveSmartTarget(rawElement);

  if (element === lastElement) return;

  // Skip the iframe's html/body — not useful targets
  if (element === iframeDoc.documentElement || element === iframeDoc.body) return;

  lastElement = element;
  lastIframeEl = iframe;

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
  }

  highlightElementInIframe(element, iframe);
  updateHighlightStyle(false);

  throttleTimeout = setTimeout(() => {
    if (!element.isConnected) return;

    const payload = gatherSelectionData(element, iframe);
    if (!payload || !payload.xpaths || payload.xpaths.length === 0) return;

    const message = { type: "XPATH_FOUND", ...payload };
    try {
      chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; });
    } catch (error) {
      // Extension context may have been invalidated
    }
  }, 50);
}

function handleIframeClick(event, iframe) {
  if (!isExtensionValid || !checkExtensionContext()) {
    cleanup();
    return;
  }
  if (!isPanelOpen || !hoverEnabled) return;

  event.preventDefault();
  event.stopPropagation();

  const coords = getIframeRelativeCoords(event, iframe);
  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) return;

  const rawElement = iframeDoc.elementFromPoint(coords.x, coords.y);
  if (!rawElement) return;

  const element = resolveSmartTarget(rawElement);

  if (element === iframeDoc.documentElement || element === iframeDoc.body) return;

  lockElementInIframe(element, iframe);
}

function handleIframeMouseLeave(event, iframe) {
  if (isLocked) return;

  removeHighlight();
  lastElement = null;
  lastIframeEl = null;

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

function lockElementInIframe(element, iframe) {
  if (isLocked) return;

  isLocked = true;
  lockedElement = element;
  lockedIframeEl = iframe;
  hoverEnabled = false;

  highlightElementInIframe(lockedElement, iframe);
  updateHighlightStyle(true);

  const payload = gatherSelectionData(lockedElement, iframe);
  if (!payload || !payload.xpaths || payload.xpaths.length === 0) {
    isLocked = false;
    lockedElement = null;
    lockedIframeEl = null;
    hoverEnabled = hoverPreference;
    return;
  }

  const message = { type: "XPATH_LOCKED", ...payload };
  try {
    chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; });
  } catch (error) {
    // Extension context may have been invalidated
  }

  try {
    chrome.runtime.sendMessage({ type: "LOCK_STATE_SYNC", locked: true });
  } catch (error) {
    // Lock sync failed
  }
}

function startIframeObserver() {
  if (iframeMutationObserver) return;

  iframeMutationObserver = new MutationObserver((mutations) => {
    let iframeChanged = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === "IFRAME" || (node.querySelector && node.querySelector("iframe"))) {
            iframeChanged = true;
            break;
          }
        }
        if (!iframeChanged) {
          for (const node of mutation.removedNodes) {
            if (node.nodeName === "IFRAME" || (node.querySelector && node.querySelector("iframe"))) {
              iframeChanged = true;
              break;
            }
          }
        }
      }
      if (iframeChanged) break;
    }

    if (iframeChanged) {
      createIframeOverlays();
    }
  });

  iframeMutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopIframeObserver() {
  if (iframeMutationObserver) {
    iframeMutationObserver.disconnect();
    iframeMutationObserver = null;
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

  const rawElement = getComposedPathTarget(event);

  if (!rawElement) {
    return;
  }

  const element = resolveSmartTarget(rawElement);

  if (
    element === lastElement ||
    element.id === "pathfinder-x-highlight" ||
    element.classList?.contains("pathfinder-x-iframe-overlay")
  ) {
    return;
  }

  lastElement = element;
  lastIframeEl = null;

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
      ...payload,
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

  const rawElement = getComposedPathTarget(event);

  if (!rawElement) {
    return;
  }

  const element = resolveSmartTarget(rawElement);

  if (
    element.tagName === "HTML" ||
    element.tagName === "BODY" ||
    element === document.documentElement ||
    element.id === "pathfinder-x-highlight" ||
    element.classList?.contains("pathfinder-x-iframe-overlay")
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
    isLocked = false;
    lockedElement = null;
    hoverEnabled = hoverPreference;
    return;
  }

  const message = {
    type: "XPATH_LOCKED",
    ...payload,
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
    // Don't intercept Space in form fields or editable elements
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) {
      return;
    }
    event.preventDefault();
    if (isLocked) {
      unlockElement();
    } else if (hoverEnabled && lastElement) {
      if (lastIframeEl) {
        lockElementInIframe(lastElement, lastIframeEl);
      } else {
        lockElement(lastElement);
      }
    }
  }
}

function unlockElement() {
  isLocked = false;
  lockedElement = null;
  lockedIframeEl = null;
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

  if (message.type === "TOGGLE_LOCK") {
    if (isLocked) {
      unlockElement();
    } else if (hoverEnabled && lastElement) {
      if (lastIframeEl) {
        lockElementInIframe(lastElement, lastIframeEl);
      } else {
        lockElement(lastElement);
      }
    }
    sendResponse({ success: true });
  } else if (message.type === "UNLOCK_ELEMENT") {
    unlockElement();
    sendResponse({ success: true });
  } else if (message.type === "PANEL_OPENED") {
    isPanelOpen = true;
    hoverEnabled = hoverPreference && !isLocked;
    attachHoverListeners();

    // Re-draw the highlight if the panel was reopened while an element is
    // still locked (e.g. rapid close/reopen before PANEL_CLOSED fires).
    if (isLocked && lockedElement && lockedElement.isConnected) {
      if (lockedIframeEl && lockedIframeEl.isConnected) {
        highlightElementInIframe(lockedElement, lockedIframeEl);
      } else {
        highlightElement(lockedElement);
      }
      updateHighlightStyle(true);
    }

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
      attachHoverListeners();
    }
    sendResponse({ success: true });
  } else if (message.type === "DISABLE_HOVER") {
    hoverPreference = false;
    hoverEnabled = false;
    // If locked, fully release the lock so state doesn't go stale
    if (isLocked) {
      unlockElement();
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
