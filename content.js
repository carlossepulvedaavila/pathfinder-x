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

// V1 XPath generation (original cascade)
function getOptimizedXPathV1(element) {
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

function isUniqueSelector(option) {
  try {
    if (option.strategy === "shadow") return true;
    if (option.strategy === "css") {
      return document.querySelectorAll(option.xpath).length === 1;
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
function generateXPathOptions(element, engine) {
  const activeEngine = engine || xpathEngine;
  const getOptimized = activeEngine === "v1"
    ? getOptimizedXPathV1
    : getOptimizedXPathV2;
  const getAlternatives = activeEngine === "v1"
    ? generateAlternativeXPathsV1
    : generateAlternativeXPathsV2;

  const options = [];

  try {
    const optimized = getOptimized(element);
    options.push({ type: "Optimized", xpath: optimized, strategy: "xpath" });

    const alternatives = getAlternatives(element);
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

function generateAlternativeXPathsV1(element) {
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

// --- V2 Engine: Shared helpers ---

function isUniqueXPath(xpath) {
  try {
    return document.evaluate(
      xpath, document, null,
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

  while (current && current !== document.body && depth < MAX_DEPTH) {
    depth++;

    if (current.id && isStableId(current.id)) {
      const escaped = CSS.escape(current.id);
      if (document.querySelectorAll(`#${escaped}`).length === 1) {
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

// --- V2 Engine: Optimized XPath with new cascade ---

function getOptimizedXPathV2(element) {
  const tag = element.tagName.toLowerCase();

  // Priority 1: Stable ID
  if (element.id) {
    const escaped = CSS.escape(element.id);
    if (
      isStableId(element.id) &&
      document.querySelectorAll(`#${escaped}`).length === 1
    ) {
      return `//*[@id=${escapeXPathString(element.id)}]`;
    }
  }

  // Priority 2: Name + type combination (form elements)
  const FORM_TAGS = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"];
  if (FORM_TAGS.includes(element.tagName)) {
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
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
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

// --- V2 Engine: Alternative XPaths ---

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
    const similarElements = document.querySelectorAll(tag);
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
  const context = buildContext(element);
  const elementInfo = buildElementInfo(element, context);

  if (comparisonMode) {
    const xpaths = generateXPathOptions(element, "v2");
    const v1Xpaths = generateXPathOptions(element, "v1");
    return { xpaths, v1Xpaths, context, elementInfo, comparisonMode: true };
  }

  const xpaths = generateXPathOptions(element);
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

function resolveSmartTarget(element) {
  if (SEMANTIC_TARGETS.has(element.tagName)) return element;

  const role = element.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return element;

  if (!WRAPPER_TAGS.has(element.tagName)) return element;

  let current = element.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 3) {
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
let xpathEngine = "v2";
let comparisonMode = false;

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

  const rawElement = getComposedPathTarget(event);

  if (!rawElement) {
    return;
  }

  const element = resolveSmartTarget(rawElement);

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

  if (message.type === "SET_XPATH_ENGINE") {
    xpathEngine = message.engine || "v2";
    comparisonMode = !!message.comparisonMode;
    sendResponse({ success: true });

    // Re-generate selectors for locked element with new engine
    if (isLocked && lockedElement && lockedElement.isConnected) {
      const payload = gatherSelectionData(lockedElement);
      const msg = { type: "XPATH_LOCKED", ...payload };
      try {
        chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; });
      } catch (e) { /* context may be invalid */ }
    }
    return;
  }

  if (message.type === "TOGGLE_LOCK") {
    if (isLocked) {
      unlockElement();
    } else if (hoverEnabled && lastElement) {
      lockElement(lastElement);
    }
    sendResponse({ success: true });
  } else if (message.type === "UNLOCK_ELEMENT") {
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
