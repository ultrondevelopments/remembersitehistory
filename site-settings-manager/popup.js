/* eslint-disable no-undef */

const SUPPORTED_CONTENT_TYPES = ["camera", "microphone", "geolocation", "notifications"];
const STORAGE_KEY = "settingsByOrigin";

function getOriginFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch (e) {
    return null;
  }
}

function getPrimaryPatternForOrigin(origin) {
  return `${origin}/*`;
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function resolveContentSettingsKey(type) {
  // Some Chromium variants may not expose certain keys. Provide a best-effort mapping and detection.
  if (chrome?.contentSettings?.[type]) return type;
  // Fallback aliases seen in some browsers (rare). Keep conservative.
  const aliases = { geolocation: "location" };
  const alias = aliases[type];
  if (alias && chrome?.contentSettings?.[alias]) return alias;
  return null;
}

function getContentSetting(type, primaryUrl) {
  return new Promise((resolve) => {
    try {
      const key = resolveContentSettingsKey(type);
      if (!key) return resolve({ error: `Unsupported content type: ${type}` });
      chrome.contentSettings[key].get({ primaryUrl }, (details) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(details);
        }
      });
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function setContentSetting(type, primaryPattern, setting) {
  return new Promise((resolve) => {
    try {
      const key = resolveContentSettingsKey(type);
      if (!key) return resolve({ error: `Unsupported content type: ${type}` });
      chrome.contentSettings[key].set({ primaryPattern, setting, scope: "regular" }, () => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve({ ok: true });
        }
      });
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

async function getFromSyncStorage(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, (items) => resolve(items)));
}

async function setInSyncStorage(obj) {
  return new Promise((resolve) => chrome.storage.sync.set(obj, () => resolve()));
}

async function removeFromSyncStorage(key) {
  return new Promise((resolve) => chrome.storage.sync.remove(key, () => resolve()));
}

async function init() {
  const statusEl = document.getElementById("status");
  const originEl = document.getElementById("origin");
  const tab = await queryActiveTab();
  if (!tab || !tab.url) {
    originEl.textContent = "No active tab URL";
    return;
  }
  const origin = getOriginFromUrl(tab.url);
  if (!origin) {
    originEl.textContent = "Unsupported URL";
    return;
  }
  originEl.textContent = origin;

  // Disable unsupported selectors upfront
  for (const type of SUPPORTED_CONTENT_TYPES) {
    const select = document.getElementById(type);
    const key = resolveContentSettingsKey(type);
    if (select && !key) {
      select.disabled = true;
      select.title = `${type} not supported in this browser`;
    }
  }

  // Load current effective settings from Chrome
  for (const type of SUPPORTED_CONTENT_TYPES) {
    const details = await getContentSetting(type, tab.url);
    const select = document.getElementById(type);
    if (!select) continue;
    if (details && details.setting && (details.setting === "allow" || details.setting === "block")) {
      select.value = details.setting;
    } else {
      select.value = ""; // No change
    }
  }

  // Save & Apply
  document.getElementById("saveApply").addEventListener("click", async () => {
    statusEl.textContent = "";
    statusEl.classList.remove("error");

    // Build payload of selected settings
    const payload = {};
    for (const type of SUPPORTED_CONTENT_TYPES) {
      const select = document.getElementById(type);
      const value = select ? select.value : "";
      if (value === "allow" || value === "block") {
        payload[type] = value;
      }
    }

    // Persist to storage
    const stored = await getFromSyncStorage([STORAGE_KEY]);
    const settingsByOrigin = stored[STORAGE_KEY] || {};
    settingsByOrigin[origin] = { ...(settingsByOrigin[origin] || {}), ...payload };
    await setInSyncStorage({ [STORAGE_KEY]: settingsByOrigin });

    // Apply rules immediately
    const primaryPattern = getPrimaryPatternForOrigin(origin);
    for (const [type, value] of Object.entries(payload)) {
      const result = await setContentSetting(type, primaryPattern, value);
      if (result.error) {
        statusEl.textContent = `Error applying ${type}: ${result.error}`;
        statusEl.classList.add("error");
        return;
      }
    }

    statusEl.textContent = "Saved and applied.";
    statusEl.classList.remove("error");
  });

  // Forget saved settings for this origin (does not change Chrome settings, just forgets our stored rules)
  document.getElementById("forget").addEventListener("click", async () => {
    statusEl.textContent = "";
    statusEl.classList.remove("error");
    const stored = await getFromSyncStorage([STORAGE_KEY]);
    const settingsByOrigin = stored[STORAGE_KEY] || {};
    if (settingsByOrigin[origin]) {
      delete settingsByOrigin[origin];
      await setInSyncStorage({ [STORAGE_KEY]: settingsByOrigin });
    }
    statusEl.textContent = "Forgot saved rules for this site.";
  });

  // Report issue via email
  const reportIssueButton = document.getElementById("reportIssue");
  if (reportIssueButton) {
    reportIssueButton.addEventListener("click", () => {
      const manifest = (chrome?.runtime?.getManifest && chrome.runtime.getManifest()) || {};
      const version = manifest.version || "unknown";

      const subject = encodeURIComponent("Site Settings Manager: Issue report");
      const selections = SUPPORTED_CONTENT_TYPES.map((type) => {
        const select = document.getElementById(type);
        const value = select ? (select.value || "no change") : "n/a";
        return `- ${type}: ${value}`;
      }).join("\n");

      const body = encodeURIComponent([
        "Describe the issue here:",
        "",
        `Origin: ${origin}`,
        `Extension version: ${version}`,
        "",
        "Current selections:",
        selections,
      ].join("\n"));

      window.open(`mailto:ultrondevelopments@gmail.com?subject=${subject}&body=${body}`);
    });
  }
}

document.addEventListener("DOMContentLoaded", init);