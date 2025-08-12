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

function resolveContentSettingsKey(type) {
  if (chrome?.contentSettings?.[type]) return type;
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
      chrome.contentSettings[key].get(
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
      const key = resolveContentSettingsKey(type);
      if (!key) return resolve({ error: `Unsupported content type: ${type}` });
      chrome.contentSettings[key].set(
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

function clearContentSetting(type) {
  return new Promise((resolve) => {
    try {
      const key = resolveContentSettingsKey(type);
      if (!key) return resolve({ error: `Unsupported content type: ${type}` });
      chrome.contentSettings[key].clear(
        { scope: "regular" },
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

  await applySavedSettingsForOrigin(origin);
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
  const stored = await getFromSyncStorage([STORAGE_KEY]);
  const settingsByOrigin = stored[STORAGE_KEY] || {};
  const origins = Object.keys(settingsByOrigin);
  for (const origin of origins) {
    await applySavedSettingsForOrigin(origin);
  }
});