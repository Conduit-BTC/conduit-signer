import {
  MAX_CHANNEL_REQUESTS,
  parseRequest,
  VERSION,
  SignerError,
  type Request,
} from "./protocol"
import { SignerVault } from "./vault"

const vault = new SignerVault()
const origins = JSON.parse(document.body.dataset.parents!) as string[]
const state = document.querySelector<HTMLOutputElement>("#state")!
const input = document.querySelector<HTMLInputElement>("#nsec")!
const form = document.querySelector<HTMLFormElement>("#import")!
const forget = document.querySelector<HTMLButtonElement>("#forget")!
const channel = new BroadcastChannel("conduit-signer")
let parentOrigin: string | null = null
let activeChannel: string | null = null
let stopped = false
let active = false
let mutating = false
let generation = 0
const seen = new Set<string>()

function invalidate() {
  generation++
  active = false
  if (parentOrigin && activeChannel)
    window.parent.postMessage(
      {
        version: VERSION,
        changed: true,
        frame: vault.frame,
        channel: activeChannel,
      },
      parentOrigin,
    )
  activeChannel = null
}
async function refresh() {
  try {
    const binding = await vault.binding()
    state.textContent = binding
      ? "Stored record available. Ready for signing."
      : "No stored record. Import your existing NSEC to connect."
    form.hidden = !!binding
    forget.hidden = !binding
  } catch {
    form.hidden = false
    forget.hidden = false
    state.textContent =
      "Storage unavailable. Signing is unavailable. Retry when storage is available, or reimport after this signer's website data is cleared."
  }
}
channel.onmessage = () => {
  vault.invalidate()
  invalidate()
  void refresh()
}
document.querySelector("#origin")!.textContent = location.origin
form.onsubmit = async (event) => {
  event.preventDefault()
  if (mutating || stopped) return
  const nsec = input.value
  input.value = ""
  mutating = true
  generation++
  active = false
  try {
    await vault.import(nsec)
    channel.postMessage("changed")
    await refresh()
  } catch (e) {
    state.textContent =
      e instanceof SignerError && e.code === "unavailable"
        ? "Import could not be saved. Storage unavailable. Retry when storage is available."
        : "Invalid NSEC. Enter an existing Nostr secret key."
  } finally {
    mutating = false
    invalidate()
  }
}
forget.onclick = async () => {
  if (mutating || stopped) return
  input.value = ""
  mutating = true
  generation++
  active = false
  try {
    await vault.logout()
    channel.postMessage("changed")
    await refresh()
  } catch {
    state.textContent =
      "Logout could not remove the stored record. Signing is unavailable in this view. Retry logout when storage is available."
  } finally {
    mutating = false
    invalidate()
  }
}
function isParent(event: MessageEvent): boolean {
  return (
    window.parent !== window &&
    window.top === window.parent &&
    event.source === window.parent &&
    origins.includes(event.origin)
  )
}
window.addEventListener("message", async (event) => {
  if (stopped || mutating || !isParent(event)) return
  const req = parseRequest(event.data)
  if (
    !req ||
    (active && req.method !== "logout" && req.method !== "status") ||
    seen.has(req.id)
  )
    return
  if (req.method === "status") {
    parentOrigin = event.origin
    if (activeChannel !== req.channel) seen.clear()
    activeChannel = req.channel
  } else if (event.origin !== parentOrigin || req.channel !== activeChannel)
    return
  if (seen.size >= MAX_CHANNEL_REQUESTS) {
    invalidate()
    return
  }
  seen.add(req.id)
  active = true
  const operation = ++generation
  const currentChannel = activeChannel
  const response = await vault.handle(structuredClone(req) as Request)
  if (stopped || activeChannel !== currentChannel || operation !== generation)
    return
  active = false
  window.parent.postMessage(response, event.origin)
  if (req.method === "logout") {
    invalidate()
    if (response.ok) channel.postMessage("changed")
  }
  if (req.method === "logout" || !response.ok) await refresh()
})
window.addEventListener("pagehide", () => {
  stopped = true
  vault.invalidate()
  invalidate()
  input.value = ""
  channel.close()
})
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload()
})
void refresh()
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => {
      document.querySelector("#offline")!.textContent =
        "Available offline after this page is cached."
    })
    .catch(() => {
      document.querySelector("#offline")!.textContent =
        "Offline page loading is unavailable in this context."
    })
}
