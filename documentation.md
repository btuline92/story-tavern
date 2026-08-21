# Story Tavern — User Guide

Story Tavern is a desktop app for writing **long stories with an AI co-writer**. You create characters, start a story, and write it chapter by chapter — asking the AI to continue the prose, plan chapters, rewrite passages, and even generate illustrations as you go.

A few things that make it different from a chat app:

- **It's built for long-form.** Tools like the summarizer, lorebooks, and Magic Complete exist to keep a novel-length story coherent without you having to re-explain everything.
- **It's local-first.** Everything you make lives in a folder on your computer (your "workspace"). Nothing is uploaded anywhere except the text you send to the AI you chose.
- **Bring your own AI.** You connect the app to an AI service with your own account key. For pictures, it talks to an image generator (ComfyUI) running on your own machine.
- **It speaks the standard character-card format** (the same "Tavern cards" used by other AI-roleplay tools), so you can import and export characters.

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [Key ideas (a quick glossary)](#2-key-ideas-a-quick-glossary)
3. [Writing a story, start to finish](#3-writing-a-story-start-to-finish)
4. [The screens](#4-the-screens)
   - [Stories](#stories)
   - [Characters](#characters)
   - [Gallery](#gallery)
   - [Photography](#photography)
   - [Presets](#presets)
   - [Plugins](#plugins)
   - [Lorebooks](#lorebooks)
   - [Images (setup)](#images-setup)
   - [Summarizer](#summarizer)
   - [Logs](#logs)
   - [Settings](#settings)
5. [Settings reference](#5-settings-reference)
6. [Tips & troubleshooting](#6-tips--troubleshooting)

---

## 1. Getting started

**Step 1 — Pick a workspace.** The first time you open the app, you choose (or create) a folder to be your **workspace**. This is where all your stories, characters, presets, and images are saved. You can switch to a different workspace later from **Settings**.

**Step 2 — Connect an AI.** Go to the **Settings** tab → **Providers & API keys**. Pick the service you have an account with — **Anthropic, OpenAI, OpenRouter, DeepSeek,** or **NanoGPT** — paste in your API key, and click **Test connection**. A green check means you're ready. (An API key is a password-like string you get from that service's website; the app stores it securely on your machine and never shows it to anyone else.)

**Step 3 — (Optional) Set up images.** If you want illustrations, you'll need **ComfyUI** (a free local image generator) running on your computer. Turn on image generation and point the app at it under **Settings → Images**. You can skip this entirely and just write.

**Step 4 — Make a character.** Go to **Characters** and either **Import…** a character card you already have, click **New** to build one by hand, or click **✨ AI** to have the model draft one from a short description.

**Step 5 — Start writing.** Go to **Stories → New story…**, give it a title, pick your character(s), optionally jot down a premise, and click **Start writing**.

---

## 2. Key ideas (a quick glossary)

- **Workspace** — the folder holding everything you make. Switchable in Settings.
- **Story → Chapters** — a story is a list of chapters. Each chapter has a **title**, an **outline** (your notes on what should happen), and the **prose** itself.
- **Character** — a reusable "card" describing a person in your stories: their looks, personality, voice, and so on. One character can appear in many stories.
- **Cast** — the set of characters attached to a story. Their descriptions are given to the AI while it writes.
- **Preset** — the recipe that decides *how the prompt is built* — which pieces of information (character description, premise, story-so-far, etc.) get sent to the AI and in what order. Most people can leave this alone.
- **Model preset** — a saved choice of *which AI model* to write with (provider + model + creativity settings). You can keep several and switch between them.
- **Provider / API key** — the AI service you use and the key that authorizes it.
- **Plugin** — a reusable snippet of instructions you can switch on per story (e.g. "favor slow-burn tension").
- **Lorebook** — a collection of background facts that get injected into the prompt **only when a keyword appears** (e.g. mention "the Iron Court" and its lore is added automatically).
- **Summarizer** — automatically condenses your oldest chapters into a running "story so far" so long stories stay affordable and in-context.
- **Magic Complete** — a feature that breaks a chapter's outline into **beats** (small steps) and writes the whole chapter beat by beat.

---

## 3. Writing a story, start to finish

This section ties the pieces together. Each screen is described in detail in [The screens](#4-the-screens).

1. **Create your cast.** Build or import your characters first (**Characters** tab). Fill in at least a **Description**; add **Appearance tags** if you plan to generate images of them.

2. **Start the story.** **Stories → New story…** → title, pick characters, add an optional premise, **Start writing**. The story opens in the editor.

3. **Write.** The editor is a normal text area you can type in freely. To have the AI take over, press **Continue ▶** — it writes the next passage in your story's voice. Use **⟳ Regenerate** if you don't like the last thing it wrote. You can add a one-line **author's note** to nudge the next passage ("make this tense").

4. **Plan a chapter (optional).** Type a rough outline in the **Chapter outline** box, or click **✨ Suggest outlines** to have the AI propose a few options you can pick from. Then either write it yourself with Continue, or use **✨ Magic Complete** to have the AI break the outline into beats and write the whole chapter.

5. **Add pictures (optional).** With image generation enabled, click **🖼 Image** to illustrate the latest passage, or turn on **auto-image after each Continue**. You can also highlight a sentence and generate an image of exactly that moment.

6. **Revise.** Highlight any text to get a floating toolbar: **✨ Rewrite** opens a box where you tell the AI how to change that passage ("make it more ominous") and preview the result before accepting.

7. **Keep it coherent as it grows.** Turn on the **Summarizer** so old chapters get folded into a running summary. Attach **Lorebooks** for world facts that should appear when relevant.

8. **Read it back.** Click **📖 Read** for a clean, full-screen reading view with adjustable text size and chapter navigation.

Everything **auto-saves** as you go.

---

## 4. The screens

The app is organized as a row of tabs down the left side: **Stories, Characters, Gallery, Photography, Presets, Plugins, Lorebooks, Images, Summarizer, Logs, Settings.**

---

### Stories

This is where your library of stories lives and where you do your writing.

#### The story library

The **Stories** screen lists every story, with a **New story…** button at the top right. Each story shows its **title**, a short **description/premise** blurb, a line reading **"N chapters · Updated [date]"**, and any **tags**.

- **Search box** — type to filter your stories by name or tag.
- **"All characters" dropdown** — show only stories featuring a particular character.
- **Clear** — appears when a search or filter is active; resets everything.
- **Open a story** — click its row.
- **📖 Read** — hover a story (with at least one chapter) and a Read button appears on the right; click it to jump straight into the distraction-free reader.
- **Delete** — hover and click the **×** in the top-right corner (asks for confirmation; this permanently deletes the story and all its chapters).
- **Pagination** — if you have more than 12 stories, use **‹ Prev / Next ›** or type a page number in the **"Page [ ] of N"** box to jump.

#### Starting a new story

**New story…** opens a small dialog:

- **Title** (required).
- **Characters** — a searchable checklist; tick one or more to form the cast (at least one required).
- **Preset (optional)** — leave as **"Workspace default"** unless you've made a custom preset.
- **Premise (optional)** — a sentence or two setting up the opening situation. You can edit it later.

Click **Start writing** to create and open the story.

#### The story editor

Once a story is open, the editor has three parts. A back button (**← Stories**) at the top returns to the library.

**Left column — chapters.** Your chapter list, with a **+ Chapter** button to add one and a word count under each. Click a chapter to edit it; hover to delete it (only if you have more than one). A **Delete story** button sits at the bottom.

**Center column — the writing area.** Top to bottom:

- A **chapter title** box, a live **word count** and save indicator (saved / unsaved / saving…), and buttons: **Copy text** (copies the chapter's prose without images), **Clear** (empties the chapter — see below), **📖 Read** (opens the reader), and a **Details** toggle for the right panel.
- A **model row** to choose which AI model preset to write this story with.
- A **Chapter outline** box for your notes on what happens in this chapter, with **✨ Suggest outlines** to get AI-generated options.
- The **prose editor** itself — type freely. This is also where inline images appear.
- The **action bar** at the bottom, with a place to type a one-line **author's note** and the main buttons (see below).

**Right column — Details panel** (toggle with the **Details** button). Collapsible sections:

- **Core** — the story's **title, description, tags, cast (characters), and preset**.
- **Plugins** — tick which reusable instruction snippets apply to this story.
- **Lorebooks** — tick which lorebooks are active for this story.
- **Premise** — the story premise fed to the AI.
- **Summary** — view/edit/delete/regenerate the story's running summary (see [Summarizer](#summarizer)).
- **Magic Complete** — inspect and edit the chapter's beats (see below).

#### Writing actions (the bottom bar)

- **Continue ▶** — the AI writes the next passage, matching your story's voice and picking up exactly where the text leaves off. It streams in live.
- **⟳ Regenerate** — discard the last generated passage and try again.
- **🖼 Image** — generate an illustration for the latest passage (only if images are enabled).
- **✨ Magic Complete** — plan the chapter's outline into beats and write the whole chapter (details below).
- **▶ Resume Magic** — appears when a Magic Complete run was stopped partway; continues where it left off.
- **Stop / Cancel** — while the AI is working, the button becomes a stop control.
- **Author's note** — a one-line steer for the next passage.

**Clearing a chapter.** The **Clear** button empties a chapter. If the chapter has both text and Magic Complete beats, it asks whether to **Clear content only** (keep the beats) or **Clear all**.

#### Magic Complete (writing a whole chapter)

Magic Complete turns a chapter outline into a finished chapter automatically:

1. It reads your **Chapter outline** and breaks it into an ordered list of **beats** (small story steps). If your outline is a numbered list, you'll roughly get one beat per item.
2. It writes each beat as its own passage, in order — optionally adding an image after each one.

You control this from the bottom bar and the **Magic Complete** section of the Details panel:

- **✨ Magic Complete** starts a fresh run (re-planning the beats). If the chapter already has text, it asks first, since it clears the chapter to start clean.
- If you stop midway, **▶ Resume Magic (3/8)** continues from where it stopped.
- In the Details panel's **Magic Complete** section you can, while stopped:
  - **✎ Edit** any beat's text,
  - **▲ / ▼** reorder beats,
  - **＋ Add beat** by hand (useful for building a plan without generating one),
  - **Delete** a beat, and
  - **↺** set the run back to an earlier beat so it re-writes from there.
- Whether Magic Complete writes straight through or **stops after planning so you can review the beats first** is controlled by the **Auto-start** setting (Settings → Magic Complete).

#### Suggesting outlines

**✨ Suggest outlines** (next to the outline box) opens a dialog where you can:

- add optional **Guidance** (a rough idea to steer the suggestions),
- choose how many **Outlines** to generate (1–6 — fewer is faster) and how many **Beats per outline**,
- click **✨ Generate** to see the options side by side, and **Use this** to drop one into your outline.

If you've turned on **Outline → beats** (Settings → Magic Complete), applying an outline also fills in the Magic Complete beats, so you can jump straight to writing.

#### Revising with highlight-to-act

Select any text in the editor and a small floating toolbar appears:

- **✨ Rewrite** — opens a box where you describe the change you want ("tighten this", "make it more tense"). The AI is given the surrounding story for context, shows you a preview, and only replaces your text when you click **Accept** (you can Regenerate or Cancel).
- **🖼 Image** — generates an illustration of exactly the highlighted passage and inserts it right after (only shown when images are enabled).

#### Inline images

Generated images appear inside the chapter. Hover an image for three corner buttons: **⧉** copy its prompt, **⟳** regenerate it, and **✕** remove it. Each image shows its prompt as a caption; click an image to view it full-screen.

#### The Reader

Click **📖 Read** (in the editor toolbar, or the hover button on the story library) for a clean, full-window reading view with no editing distractions:

- one chapter at a time, with a **chapter menu** and **‹ Prev / Next ›**,
- **A− / A+** to change text size and a **width** control,
- **word count + estimated reading time** and a scroll-progress bar,
- keyboard shortcuts: **← / →** to change chapters, **Esc** to exit.

The back button returns you to wherever you came from (the editor or the story library).

---

### Characters

Your cast of reusable characters. A list on the left, an editor on the right.

**The list (left):**

- **New** — create a blank character.
- **✨ AI** — draft a character from a short description (see below).
- **Import…** — import a standard Tavern character card (PNG or JSON).
- A **filter bar**: a **search** box, a **gender** dropdown (All / Female / Male / Untagged — inferred from the character's tags), and **tag chips** to filter by.

**The editor (right):** the top bar shows an **unsaved** indicator plus **Export as Tavern card…**, **Delete**, **Discard**, and **Save**.

- **Avatar** (top-left) — the character's picture, with **Replace avatar… / Set avatar…** (pick an image file) and **Go to gallery…** (choose one of this character's generated images as the avatar).
- **Name, Creator, Version.**
- **Tags.**
- **Description** — the main definition of who this character is.
- **Personality** and **Scenario.**
- **Image generation** box:
  - **Appearance tags** — short visual descriptors (e.g. "blonde hair, blue eyes, elf ears") that keep the character looking consistent in generated images.
  - **Per-character negative tags** — things to keep *out* of their images (e.g. "glasses, hat").
- **First message** — the character's opening greeting.
- **Message example** — sample dialogue that models their voice.
- **Alternate greetings** — extra opening messages you can add/remove.
- **Advanced** (collapsible) — **Creator notes**, a card-level **System prompt** (the character's own behavioral instructions), and **Post-history instructions** (final instructions placed late in the prompt).

> **Where do the card's "System prompt" and "Post-history instructions" go?** The System prompt is injected as the **Character instructions** block in your preset (which you can position — see [Presets](#presets)), and Post-history instructions are placed near the end of the prompt for emphasis. Leave them blank if you don't need them.

**Create with AI (✨ AI).** Describe a character in a sentence or two, click **✨ Generate**, and the model fills in a full card (name, description, personality, scenario, first message, appearance tags). Preview it and click **Use this** to save and open it for final edits.

---

### Gallery

Every saved picture, organized by character.

- **Left sidebar** — pick a character to see their pictures.
- **Dedicated** — images you explicitly saved from the Photography screen.
- **From stories** — images generated inline while writing, each labeled with its source story.
- **Hover actions**: **★ Avatar** (set that image as the character's avatar) on any picture, and **✕** (delete) on Dedicated images.
- Click any picture to view it full-screen with a **Copy prompt** button.

You can reach a specific character's gallery directly via **Go to gallery…** on their character page.

---

### Photography

A standalone image studio, separate from any story — for experimenting with pictures and prompts. Nothing is saved automatically; you choose what to keep.

- **Mode** — **Scene (tagged)** (write prose and the AI turns it into an image prompt for you) or **Direct prompt** (type the image tags yourself).
- **Characters** — pick who appears (their looks guide the image), or, in Direct mode, who to file the result under.
- **Prompt prefix set** — choose a saved style bundle (e.g. "Anime" vs "Realism").
- In Scene mode you also get a **Scene** box for the prose and two tunable **scratchpad** prompts that control the tagging AI (temporary — for permanent changes, edit the saved prompts under Settings → Images).
- **✨ Generate / ↻ Regenerate** — make the picture; a **Cancel** button and live status appear while it works.
- On the right: the image (click to zoom), the exact **positive prompt** with a **Copy** button, and **Save to gallery** (choose a character and click **Save**).

> Image generation must be enabled and ComfyUI set up (Settings → Images) for this screen to work.

---

### Presets

A preset controls **how the prompt sent to the AI is assembled** — which pieces of information are included and in what order. Most people never need to touch this; it's here for power users.

A preset is a stack of **blocks**. Each block is either:

- **Custom text** — words you write (e.g. the main "you are a fiction writer" instruction), or
- a **dynamic block** (marked "dynamic") — a placeholder that gets filled in automatically at generation time, such as **Character description, Character personality, Character instructions, Scenario, Dialogue examples, Story premise,** or **Manuscript (the story so far)**.

For each block you can:

- toggle it **on/off** with the checkbox,
- **reorder** it with **↑ / ↓**,
- **delete** it with **✕**,
- expand it to rename it, set its **role**, and choose its **Content source** (a dropdown to switch between Custom text and any dynamic block type).

Because it's block-based, you can, for example, **remove the Scenario block** entirely if a character's scenario clashes with your story premise, or move the **Character instructions** block to wherever you like.

Other controls: **New** and **Import…** (imports a SillyTavern preset), **Set active** (make this the default preset for new generations), **Export…**, **Delete**, and **Save**. Presets round-trip with SillyTavern's format.

> The built-in **Default** preset is generated fresh each time, so edits to it don't stick. To customize permanently, create (or duplicate) a preset, edit it, and **Set active**.

---

### Plugins

**Plugins** are small, reusable instruction snippets that get appended to the system prompt — a way to emphasize a kind of writing without rewriting your whole preset. For example: *"Emphasize slow-burn tension — favor sensory detail and subtext over exposition."*

- Create/edit/delete them on the **Plugins** tab (name + text).
- Turn them on **per story** in the story's **Details → Plugins** section.
- They support the `{{char}}` and `{{user}}` placeholders.

---

### Lorebooks

**Lorebooks** (also called "World Info") are collections of background facts that are injected **only when relevant**. Each **entry** has one or more **trigger keywords** and some **content**; when a keyword shows up in your recent writing, that entry's content is quietly added to the prompt. This is how you give the AI deep world knowledge without bloating every request.

On the **Lorebooks** tab:

- **New** a lorebook, or **Import…** a SillyTavern World Info file (your existing lorebooks work here). **Export…** saves one back out.
- Each **entry** has: a **title**, **Keys** (trigger keywords, comma-separated — you can even use `/regular expressions/`), optional **Secondary keys** with **Logic** (require/forbid combinations), the **Content** to inject, and toggles for **Enabled**, **Constant** (always on, no keyword needed), **Order** (priority), position, matching options, and **probability**.

Attach lorebooks to a story in **Details → Lorebooks**. The app supports **constant** (always-on) entries and **recursive** triggering (one entry's content can trigger another).

---

### Images (setup)

The **Images** tab (headed "Image generation") is where you connect and configure the image generator. Pictures are produced by **ComfyUI**, a free image generator you run locally.

- **Enable image generation** — the master on/off switch. When off, all image buttons and the Photography tab are disabled.
- **Generate an image automatically after each Continue** — when on, every new passage you write in a story gets an illustration automatically.
- **ComfyUI server URL** — the address of your local ComfyUI (default `http://127.0.0.1:8188`), with a **Test** button. A successful test also loads the available models and samplers.
- **Workflow** — which ComfyUI "recipe" to run (with **New… / Edit… / Delete**). Advanced users can edit the workflow's JSON.
- **Generation parameters** — the usual image knobs: **Model (checkpoint), VAE, Sampler, Scheduler, Steps, CFG scale, Width/Height, Seed** (-1 for random), and advanced options. Use **↻ Fetch model/sampler lists** to populate the pick-lists from ComfyUI.
- **Prompt prefix set** — named style bundles, each with a **positive prefix** and a **negative prompt**, so you can switch the overall look (e.g. anime vs realistic) in one click.
- **Tag generation** — settings for the AI that converts prose into image prompts: how it learns each character's looks (**Character description** vs **Appearance tags**), the **Tag system prompt** and **scene instruction** (both switchable and editable), and an option to use a **different, cheaper model** just for tagging.

If you don't want images, you can leave this whole tab alone.

---

### Summarizer

The **Summarizer** keeps long stories manageable. As chapters pile up, sending them all to the AI gets slow and expensive. When enabled, the summarizer folds your **oldest** chapters into a running "story so far" and drops their full text from the prompt, while keeping your most **recent** chapters word-for-word.

Settings on this tab:

- **Enable summarization** — the on/off switch.
- **Min recent chapters (N)** — how many recent chapters are always kept in full.
- **Chapters per summary (M)** — how many old chapters are folded in each time it runs.
- **Ask before summarizing** — confirm with you before each run instead of doing it silently.
- **Summarizer prompt** — the instructions the AI follows when writing the summary (you can customize tone and detail).
- **Use a different model for summarizing** — optionally run summaries on a cheaper/faster model than your main writing model.

You can view, hand-edit, delete, or regenerate the actual summary text from a story's **Details → Summary** section — handy if you edit an early chapter and want the summary to reflect it.

---

### Logs

The **Logs** tab (headed "API logs") records every call the app makes to an AI or image service. It's here for **transparency and troubleshooting** — if a generation fails, you can see exactly what was sent and what went wrong.

- Filter by **provider** or **kind** of call (continue, plan-beats, suggest-outlines, create-character, image-generate, summarize, rewrite, etc.), or tick **Errors only**.
- **Refresh** reloads the list; **Reveal in Explorer** opens the folder where logs are stored.
- Each row shows the time, a **status** badge (green success / red error), the provider, the kind of call, the model, and how long it took.
- Click a row to expand the full request and response details and any error message.

---

### Settings

General app configuration (image and summarizer settings have their own tabs). See the [full reference](#5-settings-reference) below. In short:

- **Theme** — the app's color scheme.
- **Workspace** — shows your current folder and lets you **Switch workspace…**.
- **Magic Complete** — auto-start behavior, the editable beat-planning prompt, and the outline→beats option.
- **Model presets** — your saved AI-model configurations.
- **Providers & API keys** — connect your AI accounts.
- **OpenRouter routing** — advanced routing options if you use OpenRouter.

---

## 5. Settings reference

### Theme
Choose the app's look. Options include **Midnight** (dark), **Slate**, and **Parchment** (warm/light). Saved on your machine.

### Workspace
Shows the folder your data lives in. **Switch workspace…** lets you open or create a different one (useful for keeping separate projects apart).

### Magic Complete
- **Auto-start** — **On:** Magic Complete plans a chapter's beats and writes them straight through. **Off:** it plans the beats and stops so you can review, edit, and reorder them first, then you press Resume to write.
- **Beat-planning prompt** — the exact instructions the AI uses to break an outline into beats. You can edit it (for example, to change how many beats it tends to produce) and **Reset to default**. It must tell the model to return a list of beats.
- **Outline → beats** — when on, applying a suggested outline also fills the chapter's Magic Complete beats, so you can start writing without re-planning.

### Model presets
A **model preset** is a saved bundle of *which AI model to use* plus its creativity settings (things like **temperature** and **reasoning effort**). Keep several — for example a strong model for prose and a cheap one for quick tasks — and set which is **active**. The story editor lets you switch the model preset per story.

### Providers & API keys
For each service you use — **Anthropic, OpenAI, OpenRouter, DeepSeek, NanoGPT** — paste your **API key** and **Test** the connection. Keys are stored securely on your computer. You only need to set up the provider(s) you actually use.

### OpenRouter routing
If you use OpenRouter (which can route to many models), this lets you set a preferred **provider order** and whether to **allow fallbacks**. Ignore it if you don't use OpenRouter.

---

## 6. Tips & troubleshooting

**"Nothing happens when I press Continue."** Make sure you've connected an AI in **Settings → Providers & API keys** and clicked **Test connection**. If a call fails, open the **Logs** tab and click the failed row to read the exact error.

**Long stories feel slow or expensive.** Turn on the **Summarizer** so old chapters get condensed instead of sent in full every time.

**The AI forgets world details.** Put them in a **Lorebook** with trigger keywords (or mark an entry **Constant** to always include it), and attach the lorebook to the story in **Details → Lorebooks**.

**I want the same "vibe" across a story.** Add a **Plugin** with your style instruction and switch it on in the story's **Details → Plugins**.

**Magic Complete always makes ~8 beats.** The number follows your outline. If your outline is a numbered list, you'll get roughly one beat per item. You can also edit the **beat-planning prompt** under Settings → Magic Complete.

**Images look wrong or won't generate.** Check **Settings → Images**: is **Enable image generation** on, is the **ComfyUI server URL** correct (press **Test**), and is a **Model (checkpoint)** selected? Give each character **Appearance tags** for consistent likenesses.

**I edited an early chapter and the summary is now stale.** Go to the story's **Details → Summary** and **Regenerate** (or edit it by hand).

**Where are my files?** Everything is in your **workspace** folder. Characters, stories, presets, plugins, lorebooks, and images are all plain files there — safe to back up. **Logs → Reveal in Explorer** opens the logs folder.

**Nothing seems to save.** The app auto-saves as you type. For screens with an explicit **Save** button (Presets, Lorebooks, Summarizer, character editor), the button grays out to indicate a successful save.
