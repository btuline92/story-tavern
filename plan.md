# Longform Writing App — Phase 1 Plan

## Project context

Building a SillyTavern-equivalent focused on longform prose writing (2000-3000 word chapters) rather than chat. This document covers Phase 1 only: project scaffolding, character card import, and LLM API connection. Image generation, lorebooks, chapter persistence, and prose generation are explicitly out of scope for this phase.

**Reference implementation:** `amiantos/writers-guild` on GitHub. It is located at C:\Users\tuline\LocalProjectFiles\PDE\writers-guild and use it as a reference *only* — specifically for the character card parsing logic, which is the kind of thing I'm not interested in debugging from scratch. Do not copy their stack choices (Vue + Node server) or architectural patterns. Do not import their code as a dependency. Read, understand, write our own.

## Stack

- **Electron** — desktop app shell. (Originally Tauri 2.x; switched because Rust toolchain wasn't installed on the build machine and the user opted to swap stacks rather than install Rust.)
- **React + TypeScript + Vite** — frontend framework. Scaffolded via `@quick-start/electron` (`electron-vite`).
- **Tailwind CSS v4** — styling, no component library yet (we'll evaluate shadcn/ui later if needed)
- **Zustand** — state management, lightweight and works well with vibe coding
- **Markdown files + YAML frontmatter** for persistence, NOT SQLite, NOT a database
- **Node `fs/promises`** in the main process for file I/O, no scoping ceremony required
- **Electron `safeStorage` API** for API keys (DPAPI on Windows, Keychain on macOS, libsecret on Linux)

Rationale for these choices was discussed separately; don't re-litigate them in this session. If something is genuinely blocking we'll talk about it, but defaults stand.

## Phase 1 goals (in order)

1. Tauri + React + TS project scaffolded, builds and runs
2. Workspace directory concept — user picks a folder on first launch, it gets remembered
3. Character card import from PNG (Tavern V2 spec) and JSON
4. Character storage as markdown + frontmatter files in workspace
5. Character list UI — list view, detail view, delete, no editing yet
6. API settings UI — pick provider, store API key locally, test connection
7. Support for at least: Anthropic, OpenAI, OpenRouter. Architecture should make adding more trivial.

Phase 1 is done when I can launch the app, point it at a folder, import a character card PNG from my SillyTavern install, see it in a list, click into it, see its fields rendered, and successfully ping the Anthropic API with a test "say hi" call using my key.

## Data model — characters

One markdown file per character at `{workspace}/characters/{slug}.md`. Frontmatter holds the structured fields, body holds the long-form description so it's human-editable in any text editor.

```yaml
---
id: 01HXYZ...               # ULID, generated on import
name: "Alice"
slug: "alice"
created_at: 2026-05-21T...
source: "tavern_card_v2"    # or "manual", future: "chub", etc.
avatar: "alice.png"          # relative to character file, optional
tavern_data:                  # raw fields from Tavern V2 spec, preserved verbatim
  personality: "..."
  scenario: "..."
  first_mes: "..."
  mes_example: "..."
  creator_notes: "..."
  tags: []
  # ... etc, full V2 spec
---

# Description

(The character's `description` field from the Tavern card goes here as the file body,
since it's typically the longest field and benefits from being editable as prose.)
```

Avatars are copied into `{workspace}/characters/avatars/{slug}.png` on import. Original PNG is NOT preserved separately — we extract the embedded JSON and the image becomes the avatar.

## Tavern V2 card format reference

Tavern cards are PNGs with character data embedded in a `chara` tEXt chunk, base64-encoded JSON. The V2 spec is what you'll find in writers-guild's parser. Key fields:

- `spec`: "chara_card_v2"
- `spec_version`: "2.0"
- `data`: object containing `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `character_book`, `tags`, `creator`, `character_version`, `extensions`

For Phase 1, parse all of these, store them in frontmatter, but only render `name`, `description`, `personality`, `scenario`, `first_mes`, `tags`, `creator` in the detail view. The rest are stored but not displayed yet.

Use the `png-chunks-extract` and `png-chunk-text` npm packages, or just write the chunk parsing ourselves — it's about 30 lines. Prefer writing it ourselves; PNG chunk parsing is stable and the dependencies are unmaintained.

## API connection architecture

Define an `LLMProvider` interface:

```typescript
interface LLMProvider {
  id: string;                    // "anthropic", "openai", "openrouter"
  name: string;                  // display name
  testConnection(apiKey: string): Promise<{ok: boolean, error?: string}>;
  // generate() etc. come in later phases
}
```

Each provider implementation is its own file under `src/providers/`. Phase 1 only needs `testConnection`. Implement Anthropic first (use `/v1/messages` with a one-token "hi" request), then OpenAI, then OpenRouter (same API shape as OpenAI mostly).

The actual HTTP call happens in the **main process** (Node `fetch`), exposed to the renderer via a typed IPC channel. This sidesteps CORS — the renderer never makes a direct LLM API call.

API keys are encrypted with Electron's built-in `safeStorage` API (uses Windows DPAPI / macOS Keychain / libsecret) and the resulting ciphertext is written to `{userData}/keys.bin`. The renderer never sees plaintext keys outside the moment of entry — `safeStorage.encryptString(key)` runs in the main process and only the encrypted blob round-trips.

Provider selection and key storage live in a settings panel. The settings panel persists to `{workspace}/settings.json` (everything except the API keys, which live encrypted in `{userData}/keys.bin`).

## Project structure

`electron-vite`'s convention is three roots: `src/main` (Node), `src/preload` (typed IPC bridge), `src/renderer` (React).

```
src/
  main/
    index.ts            # Electron entry: createWindow, app lifecycle, IPC handlers
    ipc/
      workspace.ts      # pickWorkspace, ensureLayout, lastWorkspace get/set
      characters.ts     # import, list, load, delete
      providers.ts      # testConnection per provider (HTTP from main)
      keys.ts           # setKey/getKey via safeStorage
    lib/
      tavernCard.ts     # PNG chunk extraction + V2 parsing (Node side)
      characterStorage.ts
      safeStore.ts      # safeStorage helpers
  preload/
    index.ts            # contextBridge: expose typed window.api
  renderer/
    src/
      components/
        CharacterList.tsx
        CharacterDetail.tsx
        Settings.tsx
        WorkspacePicker.tsx
      providers/
        types.ts        # LLMProvider interface (renderer-side contract)
        anthropic.ts    # just calls window.api.testConnection('anthropic', key)
        openai.ts
        openrouter.ts
        index.ts        # registry
      stores/
        workspace.ts
        characters.ts
        settings.ts
      App.tsx
      main.tsx
      index.css
    index.html
electron.vite.config.ts
```

## What NOT to do in this phase

- No lorebook support yet. The Tavern card field `character_book` is parsed and stored in frontmatter, but ignored by the UI.
- No prose generation. The "test connection" button is the only thing that hits the LLM.
- No character creation/editing UI. Import only.
- No chapter/story concept yet. Just characters.
- No image generation, no ComfyUI integration.
- No fancy UI polish. Tailwind defaults, clean but unstyled-looking is fine. Visual design is a later pass.
- No SQLite, no IndexedDB, no localStorage. Files only.
- No tests yet. We'll add Vitest once the shape is stable; writing tests against code that's about to be rewritten three times is wasted effort.
- No CI/CD, no build automation, no release packaging. `npm run dev` is the only command that needs to work.

## Decisions resolved during planning

1. ~~Tauri 2.x vs 3~~ — moot, switched to Electron after Rust toolchain absence surfaced.
2. **Workspace picker**: remember last-used. Pointer at `{userData}/state.json` (`lastWorkspace` key). "Switch workspace…" lives in Settings.
3. ~~Keyring plugin~~ — moot, using Electron `safeStorage` (built in).

## When you're done with Phase 1

Show me:
- `npm run dev` launching the app
- Importing a character card I'll provide
- The character appearing in the list and detail view
- The settings panel accepting an Anthropic API key
- The test connection button returning success

Then we'll spec Phase 2.