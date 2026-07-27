// TEMPORARY diagnostics for the "text box stops accepting keyboard input" bug.
//
// It is deliberately QUIET during normal use — it logs only focus changes, window blur/focus,
// and the anomaly we're hunting: a single printable keypress landing on a focused input/textarea
// that produces NO persistent value change. Each anomaly line prints two discriminators:
//   • inputEventFired=false  → the key never reached the input (focus/disabled/prevented at the DOM)
//   • inputEventFired=true   → the DOM accepted it but React reverted the value (controlled-value bug)
//
// Output goes to the DevTools console AND (via window.api.debug.log) to the main-process terminal,
// so it shows up in the `npm start` / launcher window without DevTools open.

function describe(node: EventTarget | null): string {
  if (!(node instanceof Element)) return String(node)
  const input = node as HTMLInputElement
  const tag = node.tagName.toLowerCase()
  const type = node.tagName === 'INPUT' ? `[${input.type}]` : ''
  const flags = `${input.disabled ? ' DISABLED' : ''}${input.readOnly ? ' READONLY' : ''}`
  const cls =
    typeof node.className === 'string' && node.className.trim()
      ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
      : ''
  return `${tag}${type}${cls}${flags}`
}

function emit(msg: string): void {
  const line = `[FOCUS-DIAG] ${msg}`
  console.log(line)
  try {
    window.api.debug?.log(line)
  } catch {
    /* preload may predate the debug channel */
  }
}

function isTextField(node: EventTarget | null): node is HTMLInputElement | HTMLTextAreaElement {
  return node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')
}

export function installFocusDiagnostics(): void {
  document.addEventListener('focusin', (e) => emit(`focusin  -> ${describe(e.target)}`), true)
  document.addEventListener('focusout', (e) => emit(`focusout <- ${describe(e.target)}`), true)

  // Timestamp of the most recent native `input` event, used to tell "key reached the DOM" apart
  // from "React reverted it".
  let lastInputAt = -1
  document.addEventListener('input', () => {
    lastInputAt = performance.now()
  })

  document.addEventListener(
    'keydown',
    (e) => {
      // Only scrutinize single-character keys — those must insert a character.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement
      if (!isTextField(active)) return
      const beforeLen = active.value.length
      const t0 = performance.now()
      // Check after React has had a chance to commit its render.
      setTimeout(() => {
        if (document.activeElement !== active) return
        if (active.value.length !== beforeLen) return // normal: the character landed
        emit(
          `⚠ NO-CHANGE key=${JSON.stringify(e.key)} inputEventFired=${lastInputAt >= t0} ` +
            `active=${describe(active)} hasFocus=${document.hasFocus()} defaultPrevented=${e.defaultPrevented}`
        )
      }, 60)
    },
    true
  )

  window.addEventListener('blur', () => emit(`window BLUR  hasFocus=${document.hasFocus()}`))
  window.addEventListener('focus', () => emit(`window FOCUS hasFocus=${document.hasFocus()}`))

  emit('installed — reproduce the freeze, type one letter, watch for a "NO-CHANGE" line')
}
