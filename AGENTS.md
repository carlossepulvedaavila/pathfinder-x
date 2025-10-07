# Repository Guidelines

## Project Structure & Module Organization
- `manifest.json`: Extension manifest; update permissions, icons, and metadata in sync.
- `background.js`: Service worker relaying messages between content and popup, persisting the last payload, and owning the context menu entry.
- `content.js`: DOM-facing logic that attaches hover listeners, generates optimized XPaths, and posts updates back to the runtime.
- `popup.html`, `popup.js`, `styles.css`: UI surface rendered in the action popup; keep markup, scripts, and styling aligned when adjusting components.
- `images/`: Source for action and UI artwork (16/48/128). Replace all sizes together to avoid manifest warnings.
- `README.md`: Contributor entry point; mirror any workflow or load-step changes here.

## Build, Test, and Development Commands
- No bundler is required. Edit files directly and reload the unpacked extension to see changes.
- Load locally via `chrome://extensions` -> enable Developer Mode -> **Load unpacked** -> repository root.
- Inspect background events with Chrome DevTools -> **Service Worker** and debug the popup via **Inspect views** > `popup.html`.
- Package for release with `mkdir -p dist && zip -r dist/pathfinder-x.zip . -x ".git/*" "dist/*"` from repo root.

## Coding Style & Naming Conventions
- JavaScript uses 2-space indentation, `camelCase` for identifiers, and `SCREAMING_SNAKE_CASE` only for immutable constants.
- Prefer `const`/`let` over `var`; keep functions focused and reusable.
- Default to double quotes; reserve template literals for interpolated XPath strings.
- UI class names follow existing `popup-*` and `btn-*` patterns; reuse tokens before inventing new ones.
- Leave concise `//` comments when logic (e.g., XPath heuristics) is non-obvious.

## Testing Guidelines
- Manual QA is mandatory: load the unpacked extension, hover elements to confirm XPath cards update, exercise lock/unlock, copy, and structural vs optimized options.
- Validate context menu invocation (“Get XPath”) to ensure `background.js` messaging stays synced.
- Re-test on Chrome Stable plus one Chromium-based beta build whenever `manifest.json` or permissions change.
- Capture console output for regressions; attach screenshots or GIFs demonstrating UI updates in review notes.

## Commit & Pull Request Guidelines
- Follow the repository’s Conventional Commit leaning style (`feat:`, `fix:`, `style:`) with concise imperative subjects.
- Reference impacted surfaces in the body (e.g., “popup.js, styles.css”) and note manual test steps performed.
- PRs should link issues, summarize scope, list verification steps, and include refreshed UI captures when visuals change.
- Call out any permission adjustments or new assets so reviewers can double-check Chrome extension policies.

## Security & Configuration Tips
- Keep `host_permissions` scoped to `<all_urls>` unless a narrower match supports new work; justify any expansion in PRs.
- Namescape storage keys under `pathfinder.*` to avoid collisions and keep cleanup simple.
- After icon or script renames, verify `manifest.json` paths and watch Chrome’s extensions console for load warnings.
