import { describe, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  getEventHash,
  verifyEvent,
  type Event,
} from "nostr-tools/pure"
import { nsecEncode } from "nostr-tools/nip19"
import { v2 } from "nostr-tools/nip44"
import { encrypt } from "nostr-tools/nip04"
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59"
import {
  SignerClient,
  VERSION,
  parseRequest,
  verifiedResult,
  type Request,
  type Response,
} from "../src/protocol"
import { DATABASE, SignerVault } from "../src/vault"

async function setup() {
  const factory = new IDBFactory()
  const vault = new SignerVault(factory)
  const secret = generateSecretKey()
  const encoded = nsecEncode(secret)
  await vault.import(encoded)
  const binding = (await vault.binding())!
  const request = (operation: Record<string, unknown>) =>
    ({
      version: VERSION,
      id: crypto.randomUUID(),
      channel: crypto.randomUUID(),
      frame: vault.frame,
      binding,
      ...operation,
    }) as Request
  const event = {
    kind: 1,
    pubkey: binding.pubkey,
    created_at: 1,
    tags: [],
    content: "Disposable test only",
  }
  return { factory, vault, secret, encoded, binding, request, event }
}
describe("disposable separate-origin signer proof", () => {
  test("NIP-59 seal operations interoperate for unsigned kind-14 and kind-16 rumors", async () => {
    const s = await setup()
    const peer = generateSecretKey()
    const envelopeKey = generateSecretKey()
    const peerPubkey = getPublicKey(peer)
    try {
      for (const kind of [14, 16]) {
        const draft = {
          pubkey: s.binding.pubkey,
          kind,
          created_at: 100,
          tags: [["p", peerPubkey]],
          content: "Disposable envelope check",
        }
        const rumor = { ...draft, id: getEventHash(draft) }
        const encrypted = await s.vault.handle(
          s.request({
            method: "encryptNip44",
            peer: peerPubkey,
            text: JSON.stringify(rumor),
          }),
        )
        expect(encrypted.ok).toBe(true)
        const seal = await s.vault.handle(
          s.request({
            method: "signEvent",
            event: {
              pubkey: s.binding.pubkey,
              kind: 13,
              created_at: 100,
              tags: [],
              content: encrypted.value as string,
            },
          }),
        )
        expect(seal.ok && verifyEvent(seal.value as Event)).toBe(true)
        const conversation = v2.utils.getConversationKey(
          envelopeKey,
          peerPubkey,
        )
        const wrap = finalizeEvent(
          {
            kind: 1059,
            created_at: 100,
            tags: [["p", peerPubkey]],
            content: v2.encrypt(JSON.stringify(seal.value), conversation),
          },
          envelopeKey,
        )
        conversation.fill(0)
        const decoded = unwrapEvent(wrap, peer)
        expect(
          decoded.content === rumor.content &&
            decoded.pubkey === rumor.pubkey &&
            !("sig" in decoded),
        ).toBe(true)

        const incoming = wrapEvent(
          { ...draft, pubkey: peerPubkey, tags: [["p", s.binding.pubkey]] },
          peer,
          s.binding.pubkey,
        )
        const unwrappedSeal = await s.vault.handle(
          s.request({
            method: "decryptNip44",
            peer: incoming.pubkey,
            text: incoming.content,
          }),
        )
        expect(unwrappedSeal.ok).toBe(true)
        const verifiedSeal = JSON.parse(unwrappedSeal.value as string) as Event
        expect(verifyEvent(verifiedSeal)).toBe(true)
        const unwrappedRumor = await s.vault.handle(
          s.request({
            method: "decryptNip44",
            peer: verifiedSeal.pubkey,
            text: verifiedSeal.content,
          }),
        )
        const received = JSON.parse(unwrappedRumor.value as string) as Event
        expect(
          unwrappedRumor.ok &&
            received.content === rumor.content &&
            received.pubkey === peerPubkey &&
            !("sig" in received),
        ).toBe(true)
      }
    } finally {
      peer.fill(0)
      envelopeKey.fill(0)
      s.secret.fill(0)
    }
  })
  test("imports, restores from IndexedDB and returns a complete verified event", async () => {
    const s = await setup()
    const restored = new SignerVault(s.factory)
    expect(
      JSON.stringify(await restored.binding()) === JSON.stringify(s.binding),
    ).toBe(true)
    const response = await restored.handle({
      ...s.request({ method: "signEvent", event: s.event }),
      frame: restored.frame,
    })
    expect(response.ok && verifiedResult(response.value, s.event)).toBe(true)
    expect(JSON.stringify(response).includes(s.encoded)).toBe(false)
    s.secret.fill(0)
  })
  test("NIP-44 encrypt/decrypt interoperates with an independent peer", async () => {
    const s = await setup()
    const peer = generateSecretKey()
    const peerPubkey = getPublicKey(peer)
    const key = v2.utils.getConversationKey(peer, s.binding.pubkey)
    const text = "Disposable protocol test"
    const encrypted = await s.vault.handle(
      s.request({ method: "encryptNip44", peer: peerPubkey, text }),
    )
    expect(
      encrypted.ok && v2.decrypt(encrypted.value as string, key) === text,
    ).toBe(true)
    const decrypted = await s.vault.handle(
      s.request({
        method: "decryptNip44",
        peer: peerPubkey,
        text: v2.encrypt(text, key),
      }),
    )
    expect(decrypted.ok && decrypted.value === text).toBe(true)
    const legacy = await s.vault.handle(
      s.request({
        method: "decryptLegacy",
        peer: peerPubkey,
        text: await encrypt(peer, s.binding.pubkey, text),
      }),
    )
    expect(legacy.ok && legacy.value === text).toBe(true)
    key.fill(0)
    peer.fill(0)
    s.secret.fill(0)
  })
  test("logout removes storage for other views and reimport changes authority", async () => {
    const s = await setup()
    const other = new SignerVault(s.factory)
    expect((await s.vault.handle(s.request({ method: "logout" }))).ok).toBe(
      true,
    )
    expect(await other.binding()).toBe(null)
    expect(
      (
        await other.handle({
          ...s.request({ method: "signEvent", event: s.event }),
          frame: other.frame,
        })
      ).error,
    ).toBe("disconnected")
    await s.vault.import(s.encoded)
    expect((await s.vault.binding())?.revision !== s.binding.revision).toBe(
      true,
    )
    expect((await s.vault.handle(s.request({ method: "logout" }))).error).toBe(
      "authority_changed",
    )
    expect(await s.vault.binding()).not.toBe(null)
    s.secret.fill(0)
  })
  test("wrong frame, account and revision cannot use the key", async () => {
    const s = await setup()
    for (const edit of [
      { frame: crypto.randomUUID() },
      { binding: { ...s.binding, revision: crypto.randomUUID() } },
      { event: { ...s.event, pubkey: getPublicKey(generateSecretKey()) } },
    ]) {
      expect(
        (
          await s.vault.handle({
            ...s.request({ method: "signEvent", event: s.event }),
            ...edit,
          } as Request)
        ).error,
      ).toBe("authority_changed")
    }
    s.secret.fill(0)
  })
  test("invalid imports and payloads produce content-free failures", async () => {
    const s = await setup()
    await expect(s.vault.import("invalid disposable input")).rejects.toThrow(
      "invalid_response",
    )
    expect(
      (
        await s.vault.handle(
          s.request({
            method: "decryptNip44",
            peer: s.binding.pubkey,
            text: "not ciphertext",
          }),
        )
      ).error,
    ).toBe("invalid_response")
    s.secret.fill(0)
  })
  test("blocked storage does not fall back to the parent or volatile success", async () => {
    const factory = {
      open: () => {
        throw new Error("blocked")
      },
    } as unknown as IDBFactory
    const vault = new SignerVault(factory)
    const req = {
      version: VERSION,
      id: "1",
      channel: "1",
      frame: null,
      binding: null,
      method: "status",
    } as Request
    const response = await vault.handle(req)
    expect(response.ok).toBe(false)
    expect(response.error).toBe("unavailable")
    expect("value" in response).toBe(false)
  })
  test("failed persistence never reports an import; failed logout revokes local authority", async () => {
    const s = await setup()
    let failWrites = true
    const factory = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const request = s.factory.open(...args)
        request.addEventListener("success", () => {
          const db = request.result
          const original = db.transaction.bind(db)
          db.transaction = ((
            ...args: Parameters<IDBDatabase["transaction"]>
          ) => {
            const tx = original(...args)
            if (failWrites && args[1] === "readwrite") tx.abort()
            return tx
          }) as IDBDatabase["transaction"]
        })
        return request
      },
    } as unknown as IDBFactory
    const vault = new SignerVault(factory)
    await expect(vault.import(s.encoded)).rejects.toThrow("unavailable")
    expect((await s.vault.binding())?.revision).toBe(s.binding.revision)
    await expect(vault.logout()).rejects.toThrow("unavailable")
    await expect(vault.binding()).rejects.toThrow("unavailable")
    failWrites = false
    await vault.logout()
    expect(await s.vault.binding()).toBe(null)
    s.secret.fill(0)
  })
  test("corrupt records are unavailable and can be removed; stalled storage is bounded", async () => {
    const s = await setup()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = s.factory.open(DATABASE, 1)
      req.onsuccess = () => resolve(req.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction("record", "readwrite")
      tx.objectStore("record").put({ revision: null }, "active")
      tx.oncomplete = () => resolve()
    })
    db.close()
    await expect(s.vault.binding()).rejects.toThrow("unavailable")
    await s.vault.logout()
    expect(await s.vault.binding()).toBe(null)
    const stalled = new SignerVault(
      { open: () => ({}) } as unknown as IDBFactory,
      10,
    )
    await expect(stalled.binding()).rejects.toThrow("unavailable")
    s.secret.fill(0)
  })
  test("revocation while a real signature is awaiting durable recheck suppresses the result", async () => {
    const s = await setup()
    let resume!: () => void
    let reached!: () => void
    const paused = new Promise<void>((resolve) => {
      resume = resolve
    })
    const ready = new Promise<void>((resolve) => {
      reached = resolve
    })
    class PausedVault extends SignerVault {
      override async binding() {
        reached()
        await paused
        return super.binding()
      }
    }
    const vault = new PausedVault(s.factory)
    const pending = vault.handle({
      ...s.request({ method: "signEvent", event: s.event }),
      frame: vault.frame,
    })
    await ready
    await s.vault.logout()
    resume()
    const result = await pending
    expect(result.error).toBe("authority_changed")
    expect("value" in result).toBe(false)
    s.secret.fill(0)
  })
  test("request contract rejects raw key APIs, unknown fields, invalid events and bounds", async () => {
    const s = await setup()
    const valid = s.request({ method: "signEvent", event: s.event })
    expect(parseRequest(valid) !== null).toBe(true)
    for (const invalid of [
      { ...valid, method: "export" },
      { ...valid, method: "encryptLegacy" },
      { ...valid, nsec: null },
      { ...valid, event: { ...s.event, kind: -1 } },
      { ...valid, event: { ...s.event, kind: 65536 } },
      { ...valid, event: { ...s.event, tags: [[]] } },
      { ...valid, event: { ...s.event, content: "a".repeat(65536) } },
    ])
      expect(parseRequest(invalid) === null).toBe(true)
    s.secret.fill(0)
  })
})
describe("proof request lifecycle", () => {
  test("logout cancels pending operations before accepting its result", async () => {
    const h = harness()
    const connect = h.client.request({ method: "status" })
    h.reply()
    await connect
    const work = h.client
      .request({ method: "encryptNip44", peer: h.binding.pubkey, text: "test" })
      .catch((e) => e.code)
    const logout = h.client.request({ method: "logout" })
    h.reply({ binding: null, value: null })
    expect(await work).toBe("authority_changed")
    await logout
    expect(h.client.binding).toBe(null)
    h.secret.fill(0)
  })
  function harness(timeout = 1000) {
    let sent: Request
    const client = new SignerClient((req) => {
      sent = req
    }, timeout)
    const secret = generateSecretKey()
    const binding = {
      pubkey: getPublicKey(secret),
      revision: crypto.randomUUID(),
    }
    const frame = crypto.randomUUID()
    const reply = (extra: Partial<Response> = {}) =>
      client.receive({
        version: VERSION,
        id: sent.id,
        channel: sent.channel,
        frame,
        binding,
        ok: true,
        ...extra,
      })
    return { client, binding, frame, reply, getSent: () => sent, secret }
  }
  test("change notification during status cancels the handshake and fences its late response", async () => {
    const h = harness()
    const pending = h.client.request({ method: "status" }).catch((e) => e.code)
    const sent = h.getSent()
    expect(
      h.client.receiveChange({
        version: VERSION,
        changed: true,
        frame: h.frame,
        channel: "wrong",
      }),
    ).toBe(false)
    expect(
      h.client.receiveChange({
        version: VERSION,
        changed: true,
        frame: h.frame,
        channel: sent.channel,
      }),
    ).toBe(true)
    h.reply()
    expect(await pending).toBe("authority_changed")
    expect(h.client.binding).toBe(null)
    h.secret.fill(0)
  })
  test("AbortSignal invalidates pending operation authority and rejects late results", async () => {
    const h = harness()
    const connected = h.client.request({ method: "status" })
    h.reply()
    await connected
    const abort = new AbortController()
    const pending = h.client
      .request(
        { method: "encryptNip44", peer: h.binding.pubkey, text: "test" },
        abort.signal,
      )
      .catch((e) => e.code)
    abort.abort()
    h.reply({ value: "late" })
    expect(await pending).toBe("authority_changed")
    expect(h.client.binding).toBe(null)
    h.secret.fill(0)
  })
  test("correlation and channel ignore unsolicited or stale responses", async () => {
    const h = harness()
    const pending = h.client.request({ method: "status" })
    h.reply({ id: "wrong" })
    h.reply({ channel: "wrong" })
    h.reply()
    await pending
    expect(h.client.binding?.revision === h.binding.revision).toBe(true)
    h.secret.fill(0)
  })
  test("frame replacement cancels pending operations and ignores late responses", async () => {
    const h = harness()
    const connected = h.client.request({ method: "status" })
    h.reply()
    await connected
    const pending = h.client.request({
      method: "encryptNip44",
      peer: h.binding.pubkey,
      text: "test",
    })
    const rejected = pending.catch((e) => e.code)
    h.client.reset()
    h.reply({ value: "late" })
    expect(await rejected).toBe("authority_changed")
    expect(h.client.binding).toBe(null)
    h.secret.fill(0)
  })
  test("timeout cancels authority and cannot later restore it", async () => {
    const h = harness(20)
    const pending = h.client.request({ method: "status" })
    await expect(pending).rejects.toThrow("timeout")
    h.reply()
    expect(h.client.binding).toBe(null)
    h.secret.fill(0)
  })
  test("rejects changed frame, revision and invalid signed results", async () => {
    for (const fault of ["frame", "binding", "template", "signature"]) {
      const h = harness()
      const connected = h.client.request({ method: "status" })
      h.reply()
      await connected
      const event = {
        pubkey: h.binding.pubkey,
        created_at: 1,
        kind: 1,
        tags: [],
        content: "test",
      }
      const pending = h.client.request({ method: "signEvent", event })
      const rejected = pending.catch((e) => e.code)
      const value = finalizeEvent(
        { ...event, content: fault === "template" ? "changed" : event.content },
        h.secret,
      )
      h.reply({
        frame: fault === "frame" ? "other" : h.frame,
        binding:
          fault === "binding" ? { ...h.binding, revision: "other" } : h.binding,
        value: fault === "signature" ? { ...value, sig: "invalid" } : value,
      })
      expect(await rejected).toBe(
        fault === "binding" ? "authority_changed" : "invalid_response",
      )
      expect(h.client.binding).toBe(null)
      h.secret.fill(0)
    }
  })
  test("snapshots queued templates and rejects operations after close", async () => {
    const h = harness()
    const connected = h.client.request({ method: "status" })
    h.reply()
    await connected
    const event = {
      pubkey: h.binding.pubkey,
      created_at: 1,
      kind: 1,
      tags: [["t", "test"]],
      content: "test",
    }
    const pending = h.client.request({ method: "signEvent", event })
    event.content = "mutated"
    event.tags[0][1] = "mutated"
    const req = h.getSent()
    if (req.method !== "signEvent") throw new Error("unexpected request")
    h.reply({ value: finalizeEvent(req.event, h.secret) })
    await pending
    h.client.close()
    await expect(h.client.request({ method: "status" })).rejects.toThrow(
      "disconnected",
    )
    h.secret.fill(0)
  })
})
