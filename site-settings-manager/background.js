/* eslint-disable no-undef */

const SUPPORTED_CONTENT_TYPES = [
  "camera",
  "microphone",
  "geolocation",
  "notifications"
];

const STORAGE_KEY = "settingsByOrigin";

function getOriginFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch (e) {
    return null;
  }
}

function getPrimaryPatternForOrigin(origin) {
  return `${origin}/*`;
}

async function getFromSyncStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (items) => resolve(items));
  });
}

async function setInSyncStorage(obj) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(obj, () => resolve());
  });
}

async function removeFromSyncStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(key, () => resolve());
  });
}

function getContentSetting(type, primaryUrl) {
  return new Promise((resolve) => {
    try {
      chrome.contentSettings[type].get(
        { primaryUrl },
        (details) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(details);
          }
        }
      );
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function setContentSetting(type, primaryPattern, setting) {
  return new Promise((resolve) => {
    try {
      chrome.contentSettings[type].set(
        { primaryPattern, setting, scope: "regular" },
        () => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve({ ok: true });
          }
        }
      );
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function clearContentSetting(type, primaryPattern) {
  return new Promise((resolve) => {
    try {
      chrome.contentSettings[type].clear(
        { scope: "regular" },
        () => {
          // Note: clear() removes all rules for this content type across all patterns in this scope.
          // There is no per-pattern clear() in this API. We therefore avoid calling clear() casually.
          // Instead, we only use set() to override to allow/block. We won't call clear() automatically.
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve({ ok: true });
          }
        }
      );
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

async function applySavedSettingsForOrigin(origin) {
  const pattern = getPrimaryPatternForOrigin(origin);
  const stored = await getFromSyncStorage([STORAGE_KEY]);
  const settingsByOrigin = stored[STORAGE_KEY] || {};
  const saved = settingsByOrigin[origin];
  if (!saved) return;

  for (const type of SUPPORTED_CONTENT_TYPES) {
    const desired = saved[type];
    if (!desired) continue;
    if (desired === "clear") {
      // Avoid global clear; skip to prevent wiping all user rules.
      // Users can manage clearing via the popup for now (we won't implement global clear here).
      continue;
    }
    await setContentSetting(type, pattern, desired);
  }
}

async function captureCurrentOverridesForOrigin(origin, url) {
  const stored = await getFromSyncStorage([STORAGE_KEY]);
  const settingsByOrigin = stored[STORAGE_KEY] || {};
  const existing = settingsByOrigin[origin] || {};

  let changed = false;

  for (const type of SUPPORTED_CONTENT_TYPES) {
    const details = await getContentSetting(type, url);
    if (details && !details.error) {
      const setting = details.setting;
      // Persist only explicit allow/block overrides
      if (setting === "allow" || setting === "block") {
        if (existing[type] !== setting) {
          existing[type] = setting;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    settingsByOrigin[origin] = existing;
    await setInSyncStorage({ [STORAGE_KEY]: settingsByOrigin });
  }
}

async function handleTabUrl(url) {
  const origin = getOriginFromUrl(url);
  if (!origin) return;

  // Apply any saved settings for this origin
  await applySavedSettingsForOrigin(origin);

  // Opportunistically capture current overrides for this origin
  await captureCurrentOverridesForOrigin(origin, url);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    handleTabUrl(tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(activeInfo.tabId, resolve);
    });
    if (tab?.url) {
      handleTabUrl(tab.url);
    }
  } catch (e) {
    // ignore
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // Optionally apply saved settings for all known origins at install/update
  const stored = await getFromSyncStorage([STORAGE_KEY]);
  const settingsByOrigin = stored[STORAGE_KEY] || {};
  const origins = Object.keys(settingsByOrigin);
  for (const origin of origins) {
    await applySavedSettingsForOrigin(origin);
  }
});