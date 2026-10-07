import { ProofClient, ProofError, VERSION } from "./protocol"

const origin = document.body.dataset.signer!
const mount = document.querySelector("#mount")!
const result = document.querySelector<HTMLOutputElement>("#result")!
let frame: HTMLIFrameElement
const client = new ProofClient((request) =>
  frame.contentWindow!.postMessage(request, origin),
)
function replaceFrame() {
  client.reset()
  const next = document.createElement("iframe")
  next.title = "Disposable signer import on a separate origin"
  next.src = origin + "/"
  next.referrerPolicy = "no-referrer"
  next.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms")
  next.onload = () => {
    if (frame === next) {
      client.reset()
      result.textContent = "Frame loaded. Check status to bind this session."
    }
  }
  frame = next
  mount.replaceChildren(frame)
}
window.addEventListener("message", (event) => {
  if (event.origin !== origin || event.source !== frame.contentWindow) return
  if (event.data?.version === VERSION && event.data.changed === true) {
    client.reset()
    result.textContent = "Signer changed. Check status to reconnect."
    return
  }
  client.receive(event.data)
})
async function run(action: () => Promise<void>) {
  try {
    await action()
  } catch (e) {
    result.textContent = `Check failed: ${e instanceof ProofError ? e.code : "invalid_response"}.`
  }
}
document.querySelector<HTMLButtonElement>("#status")!.onclick = () =>
  void run(async () => {
    await client.request({ method: "status" })
    result.textContent = client.binding
      ? "Connected to stored signer. No key entered in this app."
      : "Disconnected. Import in the signer frame."
  })
document.querySelector<HTMLButtonElement>("#sign")!.onclick = () =>
  void run(async () => {
    if (!client.binding) throw new ProofError("disconnected")
    await client.request({
      method: "signEvent",
      event: {
        pubkey: client.binding.pubkey,
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "Disposable feasibility check. Never published.",
      },
    })
    result.textContent =
      "PASS: exact template, public key, event hash and signature verified."
  })
document.querySelector<HTMLButtonElement>("#encrypt")!.onclick = () =>
  void run(async () => {
    if (!client.binding) throw new ProofError("disconnected")
    const peer = client.binding.pubkey
    const text = "Disposable feasibility round trip."
    const ciphertext = (await client.request({
      method: "encryptNip44",
      peer,
      text,
    })) as string
    const plaintext = await client.request({
      method: "decryptNip44",
      peer,
      text: ciphertext,
    })
    if (plaintext !== text) throw new ProofError("invalid_response")
    result.textContent = "PASS: NIP-44 v2 encryption and decryption verified."
  })
document.querySelector<HTMLButtonElement>("#logout")!.onclick = () =>
  void run(async () => {
    await client.request({ method: "logout" })
    result.textContent =
      "Logged out. Reimport required. Check other views separately."
  })
document.querySelector<HTMLButtonElement>("#reload")!.onclick = replaceFrame
document.querySelector("#origins")!.textContent =
  `${location.origin} → ${origin}`
document.querySelector("#mode")!.textContent =
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone
    ? "Installed mode observed"
    : "Browser mode observed — proof deliberately remains accessible"
window.addEventListener("pagehide", () => client.close())
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload()
})
replaceFrame()
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    result.textContent = "Offline cache unavailable. Record this as a gap."
  })
}
