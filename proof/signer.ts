import { generateSecretKey } from "nostr-tools/pure"
import { nsecEncode } from "nostr-tools/nip19"
import { parseRequest, VERSION, type Request } from "./protocol"
import { ProofVault } from "./vault"

const vault = new ProofVault()
const origins = JSON.parse(document.body.dataset.parents!) as string[]
const state = document.querySelector<HTMLOutputElement>("#state")!
const input = document.querySelector<HTMLInputElement>("#nsec")!
const channel = new BroadcastChannel("conduit-disposable-signer-proof")
let parentOrigin: string | null = null
let activeChannel: string | null = null
let stopped = false
let active = false
let generation = 0
const seen = new Set<string>()

const notifyParent = () => {
  if (parentOrigin)
    window.parent.postMessage(
      { version: VERSION, changed: true, frame: vault.frame },
      parentOrigin,
    )
}
async function refresh() {
  try {
    state.textContent = (await vault.binding())
      ? "Stored record available. Ready for signing."
      : "No stored record. Import a disposable key."
  } catch {
    state.textContent = "Storage unavailable. Feasibility has not passed."
  }
}
channel.onmessage = () => {
  generation++
  active = false
  activeChannel = null
  notifyParent()
  void refresh()
}
document.querySelector("#origin")!.textContent = location.origin
document.querySelector<HTMLButtonElement>("#fixture")!.onclick = () => {
  // Test fixture only: this control is never part of the proposed product UI.
  const secret = generateSecretKey()
  try {
    input.value = nsecEncode(secret)
    state.textContent = "Disposable fixture prepared. Import it below."
  } finally {
    secret.fill(0)
  }
}
document.querySelector<HTMLFormElement>("#import")!.onsubmit = async (
  event,
) => {
  event.preventDefault()
  if (!document.querySelector<HTMLInputElement>("#disposable")!.checked) return
  const nsec = input.value
  input.value = ""
  generation++
  active = false
  activeChannel = null
  notifyParent()
  try {
    await vault.import(nsec)
    activeChannel = null
    notifyParent()
    channel.postMessage("changed")
    await refresh()
  } catch {
    state.textContent =
      "Import failed. Use a disposable nsec; storage must be available."
  }
}
document.querySelector<HTMLButtonElement>("#forget")!.onclick = async () => {
  generation++
  active = false
  activeChannel = null
  notifyParent()
  try {
    await vault.logout()
    channel.postMessage("changed")
    await refresh()
  } catch {
    state.textContent =
      "Could not remove storage. Close this view and clear this signer's website data."
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
  if (stopped || !isParent(event)) return
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
  // One bounded request at a time; no unbounded signing queue or replay ledger.
  if (seen.size >= 512) {
    activeChannel = null
    notifyParent()
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
  if (req.method === "logout" && response.ok) {
    activeChannel = null
    channel.postMessage("changed")
    await refresh()
  }
})
window.addEventListener("pagehide", () => {
  stopped = true
  activeChannel = null
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
        "Offline cache registration complete; verify an offline relaunch."
    })
    .catch(() => {
      document.querySelector("#offline")!.textContent =
        "Offline cache unavailable in this context."
    })
}
