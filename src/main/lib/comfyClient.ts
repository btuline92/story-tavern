/**
 * Low-level ComfyUI HTTP client. Runs in the Electron main process, so it can
 * fetch the ComfyUI server directly without the CORS restriction that forces
 * SillyTavern's browser code to proxy through its Node backend.
 */

export function urlJoin(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

export interface ObjectInfoLists {
  samplers: string[]
  schedulers: string[]
  models: string[]
  vaes: string[]
}

function stringList(value: unknown): string[] {
  // ComfyUI represents an enum input as `[ ["opt1","opt2",...], {meta} ]`,
  // so the option list is the first element.
  if (Array.isArray(value) && Array.isArray(value[0])) {
    return (value[0] as unknown[]).filter((v): v is string => typeof v === 'string')
  }
  return []
}

/** GET /system_stats — throws on non-2xx or network error. */
export async function pingComfy(url: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(urlJoin(url, 'system_stats'), { signal })
  if (!res.ok) throw new Error(`ComfyUI returned HTTP ${res.status}`)
}

/** GET /object_info and extract the dropdown lists Story Tavern needs. */
export async function fetchObjectInfo(url: string, signal?: AbortSignal): Promise<ObjectInfoLists> {
  const res = await fetch(urlJoin(url, 'object_info'), { signal })
  if (!res.ok) throw new Error(`ComfyUI returned HTTP ${res.status}`)
  const data = (await res.json()) as Record<
    string,
    { input?: { required?: Record<string, unknown> } }
  >

  const ksampler = data.KSampler?.input?.required ?? {}
  const samplers = stringList(ksampler.sampler_name)
  const schedulers = stringList(ksampler.scheduler)

  const ckpts = stringList(data.CheckpointLoaderSimple?.input?.required?.ckpt_name)
  const unets = stringList(data.UNETLoader?.input?.required?.unet_name)
  const ggufs = stringList(data.UnetLoaderGGUF?.input?.required?.unet_name)
  const models = [...ckpts, ...unets, ...ggufs]

  const vaes = stringList(data.VAELoader?.input?.required?.vae_name)

  return { samplers, schedulers, models, vaes }
}

export interface GeneratedImage {
  format: string
  buffer: Buffer
}

interface HistoryImage {
  filename: string
  subfolder: string
  type: string
}

interface HistoryItem {
  status?: {
    status_str?: string
    messages?: Array<[string, Record<string, unknown>]>
  }
  outputs?: Record<string, { images?: HistoryImage[]; gifs?: HistoryImage[] }>
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(id)
          reject(new Error('aborted'))
        },
        { once: true }
      )
    }
  })
}

/**
 * Queue a fully-substituted workflow on ComfyUI, wait for it to finish, and
 * fetch the first rendered image. `workflowJson` is the workflow object's JSON
 * text (NOT wrapped in `{ "prompt": ... }` — this function wraps it).
 */
export async function submitAndFetchImage(
  url: string,
  workflowJson: string,
  signal?: AbortSignal
): Promise<GeneratedImage> {
  const promptRes = await fetch(urlJoin(url, 'prompt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"prompt": ${workflowJson}}`,
    signal
  })
  if (!promptRes.ok) {
    const text = await promptRes.text().catch(() => '')
    throw new Error(`ComfyUI rejected the prompt (HTTP ${promptRes.status}): ${text.slice(0, 500)}`)
  }
  const queued = (await promptRes.json()) as { prompt_id?: string }
  const id = queued.prompt_id
  if (!id) throw new Error('ComfyUI did not return a prompt_id')

  // Poll history until our prompt id appears.
  let item: HistoryItem | undefined
  for (;;) {
    if (signal?.aborted) throw new Error('aborted')
    const histRes = await fetch(urlJoin(url, `history/${id}`), { signal })
    if (histRes.ok) {
      const history = (await histRes.json()) as Record<string, HistoryItem>
      item = history[id]
      if (item) break
    }
    await delay(750, signal)
  }

  if (item.status?.status_str === 'error') {
    const errors =
      item.status.messages
        ?.filter((m) => m[0] === 'execution_error')
        .map((m) => {
          const d = m[1] as { exception_type?: string; exception_message?: string }
          return `${d.exception_type ?? 'Error'}: ${d.exception_message ?? ''}`
        })
        .join('\n') || ''
    throw new Error(`ComfyUI generation failed.\n${errors}`)
  }

  const outputs = Object.values(item.outputs ?? {})
  const imgInfo =
    outputs.flatMap((o) => o.images ?? []).at(0) ?? outputs.flatMap((o) => o.gifs ?? []).at(0)
  if (!imgInfo) throw new Error('ComfyUI finished but produced no image output')

  const viewUrl = new URL(urlJoin(url, 'view'))
  viewUrl.search = new URLSearchParams({
    filename: imgInfo.filename,
    subfolder: imgInfo.subfolder ?? '',
    type: imgInfo.type ?? 'output'
  }).toString()
  const imgRes = await fetch(viewUrl, { signal })
  if (!imgRes.ok) throw new Error(`Failed to fetch image from ComfyUI (HTTP ${imgRes.status})`)
  const format = (imgInfo.filename.split('.').pop() || 'png').toLowerCase()
  const buffer = Buffer.from(await imgRes.arrayBuffer())
  return { format, buffer }
}
