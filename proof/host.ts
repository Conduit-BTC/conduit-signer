import { SignerError } from "../src/protocol"
import { EmbeddedSigner } from "../src/embedded"

const origin = document.body.dataset.signer!
const mount = document.querySelector("#mount")!
const result = document.querySelector<HTMLOutputElement>("#result")!
let frame: HTMLIFrameElement
let client: EmbeddedSigner
function replaceFrame() {
  client?.close()
  const next = document.createElement("iframe")
  next.title = "Conduit Signer on a separate origin"
  next.src = origin + "/"
  next.referrerPolicy = "no-referrer"
  next.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms")
  frame = next
  client = new EmbeddedSigner(frame, origin, (status, error) => {
    result.textContent = error
      ? `Check failed: ${error.code}.`
      : status?.binding
        ? "Connected to stored signer. No key entered in this app."
        : "Disconnected. Import in the signer frame."
  })
  // Test harness access only. No signer secret crosses this boundary.
  ;(window as Window & { harness?: EmbeddedSigner }).harness = client
  mount.replaceChildren(frame)
}
async function run(action: () => Promise<void>) {
  try {
    await action()
  } catch (e) {
    result.textContent = `Check failed: ${e instanceof SignerError ? e.code : "invalid_response"}.`
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
    if (!client.binding) throw new SignerError("disconnected")
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
    if (!client.binding) throw new SignerError("disconnected")
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
    if (plaintext !== text) throw new SignerError("invalid_response")
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
