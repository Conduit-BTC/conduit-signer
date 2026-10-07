import { generateSecretKey } from "nostr-tools/pure"
import { nsecEncode } from "nostr-tools/nip19"

// Included only by --harness. The supported signer has no key creation control.
const input = document.querySelector<HTMLInputElement>("#nsec")!
document.querySelector<HTMLButtonElement>("#fixture")!.onclick = () => {
  document.querySelector<HTMLFormElement>("#import")!.hidden = false
  const secret = generateSecretKey()
  try {
    input.value = nsecEncode(secret)
  } finally {
    secret.fill(0)
  }
}
