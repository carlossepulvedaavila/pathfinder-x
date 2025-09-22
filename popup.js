document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup: DOM loaded, initializing...");

  const xpathContainer = document.getElementById("xpathContainer");
  const elementInfo = document.getElementById("elementInfo");
  const elementTag = document.getElementById("elementTag");
  const elementText = document.getElementById("elementText");
  const status = document.getElementById("status");
  const clearButton = document.getElementById("clearButton");

  console.log("Popup: All DOM elements found:", {
    xpathContainer: !!xpathContainer,
    elementInfo: !!elementInfo,
    elementTag: !!elementTag,
    elementText: !!elementText,
    status: !!status,
    clearButton: !!clearButton,
  });

  let currentXPaths = [];

  // 1. Immediately check local storage for the last saved XPath
  chrome.storage.local.get(["lastMessage"], (result) => {
    if (result.lastMessage && result.lastMessage.type === "XPATH_FOUND") {
      displayXPaths(result.lastMessage.xpaths, result.lastMessage.elementInfo);
      status.textContent = "Element Selected";
      status.className = "status active";
    } else {
      clearDisplay();
    }
  });

  // 2. Listen for real-time updates from background script while popup is open
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "XPATH_FOUND") {
      displayXPaths(message.xpaths, message.elementInfo);
      status.textContent = "Element Selected";
      status.className = "status active";
    } else if (message.type === "XPATH_CLEAR") {
      clearDisplay();
    }
  });

  function displayXPaths(xpaths, elementInfo) {
    console.log("Popup: displayXPaths called with:", { xpaths, elementInfo });

    currentXPaths = xpaths;

    // Show element info
    if (elementInfo) {
      elementTag.textContent = `<${elementInfo.tagName.toLowerCase()}>`;
      elementText.textContent = elementInfo.textContent || "No text content";
      elementInfo.style.display = "block";
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
          validation.textContent = "✓ Valid XPath";
          validation.className = "validation valid";
        } else {
          validation.textContent = "⚠ Invalid XPath";
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
    xpathContainer.innerHTML = `
      <div class="placeholder">
        Hover over any element on the webpage to generate XPath selectors optimized for Playwright and Selenium.
      </div>
    `;
    elementInfo.style.display = "none";
    clearButton.style.display = "none";
    status.textContent = "Ready";
    status.className = "status";
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

  // Initial state setup
  clearButton.addEventListener("click", clearDisplay);
});
