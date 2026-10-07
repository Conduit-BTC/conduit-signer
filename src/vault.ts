import { finalizeEvent, getPublicKey } from "nostr-tools/pure"
import { decode } from "nostr-tools/nip19"
import { v2 } from "nostr-tools/nip44"
import { decrypt } from "nostr-tools/nip04"
import {
  SignerError,
  VERSION,
  sameBinding,
  verifiedResult,
  type Binding,
  type Request,
  type Response,
} from "./protocol"

export const DATABASE = "conduit-signer"
interface Stored {
  secret: Uint8Array
  revision: string
}
export class SignerVault {
  readonly frame = crypto.randomUUID()
  private generation = 0
  private revoked = false
  private secrets = new Set<Uint8Array>()
  invalidate() {
    this.generation++
    for (const secret of this.secrets) secret.fill(0)
    this.secrets.clear()
  }
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly storageTimeout = 2500,
  ) {}
  private async db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = this.factory.open(DATABASE, 1)
      } catch {
        reject(new SignerError("unavailable"))
        return
      }
      let failed = false
      const timer = setTimeout(() => fail(), this.storageTimeout)
      const fail = () => {
        clearTimeout(timer)
        failed = true
        reject(new SignerError("unavailable"))
      }
      request.onupgradeneeded = () => request.result.createObjectStore("record")
      request.onerror = fail
      request.onblocked = fail
      request.onsuccess = () => {
        clearTimeout(timer)
        if (failed) request.result.close()
        else resolve(request.result)
      }
    })
  }
  private deadline(tx: IDBTransaction, reject: (error: SignerError) => void) {
    const timer = setTimeout(() => {
      reject(new SignerError("unavailable"))
      try {
        tx.abort()
      } catch {
        /* A completed transaction cannot be aborted. */
      }
    }, this.storageTimeout)
    return () => clearTimeout(timer)
  }
  private async read(): Promise<Stored | null> {
    const db = await this.db()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("record", "readonly")
        const done = this.deadline(tx, reject)
        const req = tx.objectStore("record").get("active")
        tx.oncomplete = () => {
          done()
          const record = req.result
          if (record === undefined) return resolve(null)
          if (
            !record ||
            !(record.secret instanceof Uint8Array) ||
            record.secret.length !== 32 ||
            typeof record.revision !== "string" ||
            !/^[a-zA-Z0-9-]{1,80}$/.test(record.revision)
          ) {
            if (record?.secret instanceof Uint8Array) record.secret.fill(0)
            return reject(new SignerError("unavailable"))
          }
          resolve(record)
        }
        tx.onabort = tx.onerror = () => {
          done()
          reject(new SignerError("unavailable"))
        }
      })
    } catch {
      throw new SignerError("unavailable")
    } finally {
      db.close()
    }
  }
  private async write(record: Stored | null): Promise<void> {
    const db = await this.db()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("record", "readwrite")
        const done = this.deadline(tx, reject)
        tx.oncomplete = () => {
          done()
          resolve()
        }
        tx.onabort = tx.onerror = () => {
          done()
          reject(new SignerError("unavailable"))
        }
        try {
          const store = tx.objectStore("record")
          if (record) store.put(record, "active")
          else store.delete("active")
        } catch {
          done()
          reject(new SignerError("unavailable"))
        }
      })
    } catch {
      throw new SignerError("unavailable")
    } finally {
      db.close()
    }
  }
  async import(nsec: string): Promise<void> {
    let secret: Uint8Array | undefined
    try {
      if (nsec.trim().length !== 63) throw new SignerError("invalid_response")
      const parsed = decode(nsec.trim())
      if (parsed.type !== "nsec") throw new SignerError("invalid_response")
      secret = parsed.data
      getPublicKey(secret)
      this.invalidate()
      // Persist only after validation; failure never reports an imported account.
      await this.write({ secret, revision: crypto.randomUUID() })
      this.revoked = false
    } catch (e) {
      throw e instanceof SignerError ? e : new SignerError("invalid_response")
    } finally {
      secret?.fill(0)
    }
  }
  async binding(): Promise<Binding | null> {
    if (this.revoked) throw new SignerError("unavailable")
    const record = await this.read()
    if (!record) return null
    try {
      return { pubkey: getPublicKey(record.secret), revision: record.revision }
    } catch {
      throw new SignerError("unavailable")
    } finally {
      record.secret.fill(0)
    }
  }
  async logout() {
    this.invalidate()
    this.revoked = true
    await this.write(null)
    this.revoked = false
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
      if (req.frame !== this.frame) throw new SignerError("authority_changed")
      if (req.method === "logout") {
        // Revoke this view even if reading the record for cleanup fails.
        this.invalidate()
        this.revoked = true
      } else if (this.revoked) throw new SignerError("unavailable")
      const operation = this.generation
      record = await this.read()
      if (operation !== this.generation)
        throw new SignerError("authority_changed")
      if (!record) throw new SignerError("disconnected")
      this.secrets.add(record.secret)
      const binding = {
        pubkey: getPublicKey(record.secret),
        revision: record.revision,
      }
      if (!sameBinding(req.binding, binding))
        throw new SignerError("authority_changed")
      let value: unknown
      if (req.method === "logout") {
        // Conditional delete avoids a stale view deleting a later import.
        const db = await this.db()
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("record", "readwrite")
            const done = this.deadline(tx, reject)
            const store = tx.objectStore("record")
            let stale = false
            const read = store.get("active")
            read.onsuccess = () => {
              const current = read.result as Stored | undefined
              if (current?.revision !== binding.revision) {
                stale = true
                tx.abort()
              } else store.delete("active")
              if (current?.secret instanceof Uint8Array) current.secret.fill(0)
            }
            tx.oncomplete = () => {
              done()
              resolve()
            }
            tx.onabort = tx.onerror = () => {
              done()
              reject(
                new SignerError(stale ? "authority_changed" : "unavailable"),
              )
            }
          })
        } finally {
          db.close()
        }
        this.revoked = false
        return { ...base, ok: true, binding: null, value: null }
      }
      if (req.method === "signEvent") {
        if (req.event.pubkey !== binding.pubkey)
          throw new SignerError("authority_changed")
        value = finalizeEvent(structuredClone(req.event), record.secret)
        if (!verifiedResult(value, req.event))
          throw new SignerError("invalid_response")
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
      if (
        operation !== this.generation ||
        !sameBinding(binding, await this.binding())
      )
        throw new SignerError("authority_changed")
      return { ...base, ok: true, binding, value }
    } catch (e) {
      return {
        ...base,
        ok: false,
        binding: null,
        error: e instanceof SignerError ? e.code : "invalid_response",
      }
    } finally {
      if (record) this.secrets.delete(record.secret)
      record?.secret.fill(0)
    }
  }
}
