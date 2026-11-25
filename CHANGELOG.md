# Changelog

## [1.2.0] — 2026-11-25

### Desktop
- **Nova's own title bar on Windows** — a frameless window with Nova's font, icon and light/dark colours; the menu shortcuts still work.
- **Portable .exe tidies up** — old copies unpacked into Temp by earlier launches are removed; the Bridge gets its own stable copy.
- **Update check on every launch** — while Check for updates is on, Nova asks GitHub each time it opens (it used to wait a day).

### Nova Bridge
- **Antigravity sign-in** — a signed-in Antigravity (the agy CLI or app) is used straight away, and its token is renewed when Google refuses it.
- **Gemini app sign-in** — Chrome, Edge and Brave sign in through a plain window Google accepts, then the cookies are read unseen; Firefox reads the new XDG profile folder and one cookie jar only, so mixed or expired sign-ins no longer read as signed out.
- **Sign-in messages** — a sign-in's progress or error is shown in full and can be copied.
- Nova Bridge is always listed first under Model and can't be removed.

### Look & Settings
- **Chat bubbles** — greys that stand off the page in both modes; skins paint their own.
- **Settings copy trimmed** — most descriptions removed or cut to one short line.
- Settings → Model replaces the old Providers wording everywhere; a setup marker shows until a provider is working.
- Dropdown lists use the app's colours; hover zoom only on real controls; the character creator uses two columns on desktop.

## [1.1.0] — 2026-11-23

### Character Creator
- **Advanced character editor** — an Advanced toggle opens structured fields for description (appearance, story, speech, movement, thoughts, feelings) and personality (likes, dislikes, goals, fears, quirks, limits), editable as individual sections or as free text.
- **Character profile template** — new `characterTemplate.js` parses and renders profile sections; cards round-trip between structured and plain text seamlessly.
- **Card Studio rewrite** — the AI writer now uses a swappable writing prompt (`src/prompts/card-studio/default.txt`) instead of hard-coded instructions; cleaner system/user split; interview questions built into the prompt.
- **JSON card export** — characters can be exported as `.json` (Character Card V2) alongside the existing PNG card export.
- **Scenario field** — the scenario field is now visible and editable in advanced mode.
- **Tags field** — tags are shown and round-tripped as a string array.

### Chat & Conversation
- **Memory conflict detection** — when a reply style brings its own tracker or summary, Nova detects the overlap and offers to turn off its own scene tracker, story summary, or recall for that chat (or globally). New `MemoryConflict` sheet.
- **Editable bubble improvements** — on phones the save/cancel buttons float near the caret instead of sitting at the bottom; a caret-tracking mirror positions them beside the edit point.
- **Display regex macro substitution** — regex scripts that use `{{user}}` and `{{char}}` in their patterns now fill those from the active chat, with optional escaping (substituteRegex modes 1 and 2).
- **Error island linger** — a failed activity job stays visible for 30 seconds (up from 2.5 s) so the error can be read.
- **Chat list in desktop layout** — a toggle opens the chats list as a panel beside the open chat, keeping the navigation rail.

### Reply Styles & Presets
- **Full SillyTavern preset fidelity** — imported presets now keep their layout order (marker positions for card sections), impersonate/continue blocks, scenario/personality/world format strings, and "saved" regex scripts.
- **Max reply length raised to 128 k tokens** — the slider now reaches 128 000 tokens, clamped per model to its published output limit (Gemini 2.5+: 65 k; Claude 4/5: 64 k; GPT-5/o-series: 128 k; etc.).
- **Output-limit table** — `styles.js` ships a table of known model families and their output caps; the tuning slider and the sent request respect it.
- **Reply style token count** — `styleTokens()` estimates how many tokens a preset's own text adds to every request, shown in the UI.

### Skins & Appearance
- **Animated skin tiles** — the Look → Skin picker shows each skin's first scene as a looping animated WebP (`SkinTile.jsx`), playing only while on screen and motion is Full.
- **Skin-in-chats default changed** — "Skin in chats" now defaults to off (the chat itself is plain black or white; the rest keeps the skin).
- **Look page desktop layout** — the skin picker and the rest of Look flow into two balanced columns on wide windows.
- **Background per-screen filtering** — a "Only desktop pictures" toggle on a wide screen skips phone-shaped backgrounds; a phone always skips desktop-only ones.
- **Background crop editor** — the editor now has a phone/desktop shape switch; each crop is kept beside the other and each screen shows its own. Recropping starts from the saved crop's shape and position.
- **Background thumbnails** — the thumbnail row shows each picture at its own aspect ratio (no forced square), greyed when it is not shown on this screen.
- **Higher-resolution scene layers** — all three Nova night scenes (Afterglow, Ignition, Outburst) ship with larger, higher-quality WebP layers for both phone and desktop.

### Nova Bridge
- **System tray** — the Bridge window can close to the tray; an icon in the status area brings it back. On by default; toggled from Bridge settings. Closing while hosting hides instead of quitting.
- **Gemini model list** — `parseGeminiModelList` reads the app's own model picker (otAQ7b batchexecute), returning every model the account can see, locked ones included.
- **Batch helper** — `_batch()` refactors the batchexecute call into a reusable method; `listModels()` and `deleteConversation()` both use it.
- **Delete-conversation verification** — `deleteConversation` now returns whether the rpc itself answered, checked against the history list.
- **Tray setting** — Bridge settings expose a "Keep running in the tray" toggle.

### Speech (TTS)
- **Cancel-then-speak fix** — a `speak()` right after `cancel()` on Chromium is deferred by 120 ms so the engine does not swallow it.
- **Start watchdog** — if no `start` event arrives within 8 seconds the utterance is cancelled and `onError` is called, catching silent-failure engines (Android WebView with no TTS, desktop Linux without speech-dispatcher).
- **Voice loading** — `loadVoices()` waits for the engine to populate its list (polls + voiceschanged), resolving once voices arrive or the timeout expires.
- **Speech diagnostics** — `speechProblem()` returns a one-line explanation of what is missing (Android: no engine; Linux: install speech-dispatcher; browser: permission).
- **Paused-engine fix** — `stopSpeech()` resumes a paused engine before cancelling, so the next `speak()` is not swallowed.
- **Voice language** — when a matched voice has a `.lang`, it is set on the utterance so the engine picks the right pronunciation.

### HTML & Preset Styling
- **Scoped preset CSS** — a reply style's own `<style>` blocks are now allowed, fenced: every class and id is prefixed `pv-`, every rule scoped to `.nv-pv` (the bubble), and unsafe values (`url()`, `expression()`, `@import`, `position:fixed/sticky`) are stripped. SVG icons in preset HTML are allowed.
- **CSS sanitiser** — `scopeCss()` walks at-rules (media, supports, container, layer, keyframes), rewrites selectors, cleans declarations, and caps `z-index` to 20.

### SillyTavern Import Compatibility
- **Injection triggers** — blocks that fire only on `impersonate` or `continue` are saved in the preset's `modes`; `swipe` and `regenerate` map to `normal`.
- **Format strings** — `scenario_format`, `personality_format` and `wi_format` are imported as `formats`.
- **Saved regex scripts** — scripts that are neither prompt-only nor display-only (the message itself is rewritten) are imported as `saved`.
- **Regex macro substitution** — `substituteRegex` mode 1 (fill macros) and 2 (fill and escape) are now honoured in pattern matching.

### Settings & UI
- **Settings flow layout** — the Replies tab on a wide window uses a balanced two-column flow (`.nv-settings-flow`) so blocks fill evenly.
- **Conversation memory relocated** — the conversation-memory slider moved from Replies into the chat's own controls for easier access.
- **Backup defaults guard** — restoring a backup from before the current defaults generation no longer brings older defaults back.
- **Phone settings** — reworked Phone settings with more controls.

### Tests
- **37 new or expanded tests** — Card Studio, Gemini Web (model list parsing, batch calls), TTS (cancel/speak race, start watchdog, loadVoices, speechProblem, paused resume, voice lang, deferred speak), tavern import (triggers, formats, layout, modes, saved regex, macro substitution), HTML scoping (scopeCss, pv- prefix, style blocks), display regex, memory conflicts, activity error linger, bubble editing, card export, background shapes, defaults generation, and more.

### Fixes
- **Light mode scene colours** — only Nova's scene picture is inverted; the haze and the chat wash keep their colours.
- **Android icon switch** — the launcher icon changes at the next start, never while Nova is open.
- **Backup defaults** — a backup from before the current defaults generation does not overwrite newer defaults.


## [1.0.0] — 2026-11-10

Initial public release.
