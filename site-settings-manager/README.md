# Site Settings Manager (MV3)

Remembers and reapplies site permissions (camera, microphone, geolocation, notifications) per-origin using the Chrome `contentSettings` API.

## Install (unpacked)

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable "Developer mode" (top-right).
3. Click "Load unpacked" and select the `/workspace/site-settings-manager` folder.
4. Pin the extension and open a page like Webex or Teams. Use the popup to Save & Apply.

## What it does

- Lets you save per-origin allow/block rules for camera, microphone, geolocation and notifications.
- Automatically reapplies saved rules on navigation to matching origins.
- Opportunistically captures existing allow/block overrides you already set in Chrome when you visit a site and syncs them (
  if you have Chrome sign-in/sync enabled).

## Permissions

- `contentSettings`: needed to read and set per-site rules.
- `storage`: saves rules in `chrome.storage.sync` for portability.
- `tabs` and `<all_urls>` host permissions: needed to detect current tab and apply rules for visited sites.

## Notes and limitations

- The `contentSettings.clear()` API is global per content type and scope; there is no per-pattern clear. This extension avoids calling it automatically to prevent wiping all user rules.
- There is no API to list all site settings across all sites. The extension captures rules as you visit sites and as you Save them in the popup.
- Incognito windows are not handled specially. You can add handling using `scope: "incognito_session_only"` if desired.
- The available `setting` values vary per content type. This extension uses `allow`/`block`, which are supported for the targeted types.