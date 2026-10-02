import { finalizeEvent, getPublicKey } from "nostr-tools/pure"
import { decode } from "nostr-tools/nip19"
import { v2 } from "nostr-tools/nip44"
import { decrypt } from "nostr-tools/nip04"
import {
  ProofError,
  VERSION,
  sameBinding,
  verifiedResult,
  type Binding,
  type Request,
  type Response,
} from "./protocol"

export const DATABASE = "conduit-disposable-signer-proof"
interface Stored {
  secret: Uint8Array
  revision: string
}
export class ProofVault {
  readonly frame = crypto.randomUUID()
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private async db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = this.factory.open(DATABASE, 1)
      } catch {
        reject(new ProofError("unavailable"))
        return
      }
      let failed = false
      const fail = () => {
        failed = true
        reject(new ProofError("unavailable"))
      }
      request.onupgradeneeded = () => request.result.createObjectStore("record")
      request.onerror = fail
      request.onblocked = fail
      request.onsuccess = () => {
        if (failed) request.result.close()
        else resolve(request.result)
      }
    })
  }
  private async read(): Promise<Stored | null> {
    const db = await this.db()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("record", "readonly")
        const req = tx.objectStore("record").get("active")
        tx.oncomplete = () => resolve(req.result ?? null)
        tx.onabort = tx.onerror = () => reject(new ProofError("unavailable"))
      })
    } finally {
      db.close()
    }
  }
  private async write(record: Stored | null): Promise<void> {
    const db = await this.db()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("record", "readwrite")
        const store = tx.objectStore("record")
        if (record) store.put(record, "active")
        else store.delete("active")
        tx.oncomplete = () => resolve()
        tx.onabort = tx.onerror = () => reject(new ProofError("unavailable"))
      })
    } finally {
      db.close()
    }
  }
  async import(nsec: string): Promise<void> {
    let secret: Uint8Array | undefined
    try {
      const parsed = decode(nsec.trim())
      if (parsed.type !== "nsec") throw new ProofError("invalid_response")
      secret = parsed.data
      getPublicKey(secret)
      await this.write({ secret, revision: crypto.randomUUID() })
    } catch (e) {
      throw e instanceof ProofError ? e : new ProofError("invalid_response")
    } finally {
      secret?.fill(0)
    }
  }
  async binding(): Promise<Binding | null> {
    const record = await this.read()
    if (!record) return null
    try {
      return { pubkey: getPublicKey(record.secret), revision: record.revision }
    } catch {
      throw new ProofError("unavailable")
    } finally {
      record.secret.fill(0)
    }
  }
  async logout() {
    await this.write(null)
  }
  async handle(req: Request): Promise<Response> {
    const base = {
      version: VERSION,
      id: req.id,
      channel: req.channel,
      frame: this.frame,
    } as const
    let record: Stored | null = null
    try {
      if (req.method === "status")
        return { ...base, ok: true, binding: await this.binding() }
      if (req.frame !== this.frame) throw new ProofError("authority_changed")
      record = await this.read()
      if (!record) throw new ProofError("disconnected")
      const binding = {
        pubkey: getPublicKey(record.secret),
        revision: record.revision,
      }
      if (!sameBinding(req.binding, binding))
        throw new ProofError("authority_changed")
      let value: unknown
      if (req.method === "logout") {
        // Conditional delete avoids a stale view deleting a later import.
        const db = await this.db()
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("record", "readwrite")
            const store = tx.objectStore("record")
            const read = store.get("active")
            read.onsuccess = () => {
              const current = read.result as Stored | undefined
              if (current?.revision !== binding.revision) tx.abort()
              else store.delete("active")
              current?.secret.fill(0)
            }
            tx.oncomplete = () => resolve()
            tx.onabort = tx.onerror = () =>
              reject(new ProofError("authority_changed"))
          })
        } finally {
          db.close()
        }
        return { ...base, ok: true, binding: null, value: null }
      }
      if (req.method === "signEvent") {
        if (req.event.pubkey !== binding.pubkey)
          throw new ProofError("authority_changed")
        value = finalizeEvent(structuredClone(req.event), record.secret)
        if (!verifiedResult(value, req.event))
          throw new ProofError("invalid_response")
      } else if (req.method === "decryptLegacy")
        value = await decrypt(record.secret, req.peer, req.text)
      else {
        const key = v2.utils.getConversationKey(record.secret, req.peer)
        try {
          value =
            req.method === "encryptNip44"
              ? v2.encrypt(req.text, key)
              : v2.decrypt(req.text, key)
        } finally {
          key.fill(0)
        }
      }
      if (!sameBinding(binding, await this.binding()))
        throw new ProofError("authority_changed")
      return { ...base, ok: true, binding, value }
    } catch (e) {
      return {
        ...base,
        ok: false,
        binding: null,
        error: e instanceof ProofError ? e.code : "invalid_response",
      }
    } finally {
      record?.secret.fill(0)
    }
  }
}
