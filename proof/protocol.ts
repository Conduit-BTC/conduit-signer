import {
  getEventHash,
  verifyEvent,
  type Event,
  type UnsignedEvent,
} from "nostr-tools/pure"

export const VERSION = "conduit-signer-proof-1"
export const MAX_TEXT = 65_535
export type Failure =
  | "disconnected"
  | "unavailable"
  | "timeout"
  | "invalid_response"
  | "authority_changed"
export class ProofError extends Error {
  constructor(readonly code: Failure) {
    super(code)
  }
}
export interface Binding {
  pubkey: string
  revision: string
}
export interface Status {
  frame: string
  binding: Binding | null
}
export type Operation =
  | { method: "status" }
  | { method: "logout" }
  | { method: "signEvent"; event: UnsignedEvent }
  | {
      method: "encryptNip44" | "decryptNip44" | "decryptLegacy"
      peer: string
      text: string
    }
export type Request = Operation & {
  version: typeof VERSION
  id: string
  channel: string
  frame: string | null
  binding: Binding | null
}
export interface Response {
  version: typeof VERSION
  id: string
  channel: string
  frame: string
  binding: Binding | null
  ok: boolean
  value?: unknown
  error?: Failure
}
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)
export const isToken = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v)
export const isPubkey = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v)
export function sameBinding(a: Binding | null, b: Binding | null): boolean {
  return a === null
    ? b === null
    : b !== null && a.pubkey === b.pubkey && a.revision === b.revision
}
export function isBinding(v: unknown): v is Binding | null {
  return (
    v === null ||
    (isRecord(v) &&
      isPubkey(v.pubkey) &&
      isToken(v.revision) &&
      Object.keys(v).length === 2)
  )
}
export function isUnsigned(v: unknown): v is UnsignedEvent {
  return (
    isRecord(v) &&
    isPubkey(v.pubkey) &&
    Number.isSafeInteger(v.kind) &&
    Number(v.kind) >= 0 &&
    Number(v.kind) <= 65535 &&
    Number.isSafeInteger(v.created_at) &&
    Number(v.created_at) >= 0 &&
    typeof v.content === "string" &&
    v.content.length <= MAX_TEXT &&
    Array.isArray(v.tags) &&
    v.tags.length <= 256 &&
    v.tags.every(
      (t) =>
        Array.isArray(t) &&
        t.length > 0 &&
        t.length <= 64 &&
        t.every((s) => typeof s === "string" && s.length <= 2048),
    ) &&
    Object.keys(v).sort().join() === "content,created_at,kind,pubkey,tags"
  )
}
export function parseRequest(v: unknown): Request | null {
  if (
    !isRecord(v) ||
    v.version !== VERSION ||
    !isToken(v.id) ||
    !isToken(v.channel) ||
    !(v.frame === null || isToken(v.frame)) ||
    !isBinding(v.binding)
  )
    return null
  const base = ["version", "id", "channel", "frame", "binding", "method"]
  let extra: string[] = []
  if (v.method === "signEvent") {
    if (!isUnsigned(v.event)) return null
    extra = ["event"]
  } else if (
    ["encryptNip44", "decryptNip44", "decryptLegacy"].includes(String(v.method))
  ) {
    if (
      !isPubkey(v.peer) ||
      typeof v.text !== "string" ||
      !v.text.length ||
      v.text.length > MAX_TEXT * 2
    )
      return null
    extra = ["peer", "text"]
  } else if (v.method !== "status" && v.method !== "logout") return null
  if (Object.keys(v).some((k) => ![...base, ...extra].includes(k))) return null
  if (JSON.stringify(v).length > 200_000) return null
  return v as unknown as Request
}
export function verifiedResult(v: unknown, draft: UnsignedEvent): v is Event {
  if (
    !isRecord(v) ||
    Object.keys(v).sort().join() !==
      "content,created_at,id,kind,pubkey,sig,tags"
  )
    return false
  try {
    // A fresh object prevents nostr-tools' verification cache from accepting mutation.
    const event = JSON.parse(JSON.stringify(v)) as Event
    return (
      event.pubkey === draft.pubkey &&
      event.created_at === draft.created_at &&
      event.kind === draft.kind &&
      event.content === draft.content &&
      JSON.stringify(event.tags) === JSON.stringify(draft.tags) &&
      event.id === getEventHash(event) &&
      verifyEvent(event)
    )
  } catch {
    return false
  }
}

/** Dev proof transport only. Production must adapt to the existing SessionSigner. */
export class ProofClient {
  private channel = crypto.randomUUID()
  private status: Status | null = null
  private closed = false
  private pending = new Map<
    string,
    {
      request: Request
      resolve: (v: unknown) => void
      reject: (e: ProofError) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(
    private readonly send: (v: Request) => void,
    private readonly timeout = 3000,
  ) {}
  get binding() {
    return this.status?.binding ?? null
  }
  private cancelPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new ProofError("authority_changed"))
    }
    this.pending.clear()
  }
  reset() {
    this.channel = crypto.randomUUID()
    this.status = null
    this.cancelPending()
  }
  close() {
    this.closed = true
    this.reset()
  }
  receive(v: unknown) {
    if (
      !isRecord(v) ||
      v.version !== VERSION ||
      v.channel !== this.channel ||
      typeof v.id !== "string"
    )
      return
    const p = this.pending.get(v.id)
    if (!p) return
    this.pending.delete(v.id)
    clearTimeout(p.timer)
    const fail = (code: Failure) => {
      p.reject(new ProofError(code))
      this.reset()
    }
    if (
      Object.keys(v).some(
        (k) =>
          ![
            "version",
            "id",
            "channel",
            "frame",
            "binding",
            "ok",
            "value",
            "error",
          ].includes(k),
      ) ||
      !isToken(v.frame) ||
      !isBinding(v.binding) ||
      typeof v.ok !== "boolean" ||
      (p.request.frame !== null && v.frame !== p.request.frame)
    )
      return fail("invalid_response")
    if (!v.ok) {
      const code = [
        "disconnected",
        "unavailable",
        "timeout",
        "invalid_response",
        "authority_changed",
      ].includes(String(v.error))
        ? (v.error as Failure)
        : "invalid_response"
      return fail(code)
    }
    const req = p.request
    if (req.method === "status") {
      this.status = { frame: v.frame, binding: v.binding }
      p.resolve(this.status)
    } else if (req.method === "logout") {
      if (v.binding !== null || v.value !== null)
        return fail("invalid_response")
      p.resolve(null)
      this.reset()
    } else {
      if (!sameBinding(req.binding, v.binding)) return fail("authority_changed")
      if (
        req.method === "signEvent"
          ? !verifiedResult(v.value, req.event)
          : typeof v.value !== "string" || v.value.length > MAX_TEXT * 2
      )
        return fail("invalid_response")
      p.resolve(v.value)
    }
  }
  request(op: Operation): Promise<unknown> {
    if (this.closed) return Promise.reject(new ProofError("disconnected"))
    if (op.method !== "status" && !this.status?.binding)
      return Promise.reject(new ProofError("disconnected"))
    // Status is a connection handshake, never an implicit account switch.
    if (op.method === "status") this.reset()
    if (op.method === "logout") this.cancelPending()
    const request = structuredClone({
      ...op,
      version: VERSION,
      id: crypto.randomUUID(),
      channel: this.channel,
      frame: this.status?.frame ?? null,
      binding: this.status?.binding ?? null,
    }) as Request
    if (!parseRequest(request))
      return Promise.reject(new ProofError("invalid_response"))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new ProofError("timeout"))
        this.reset()
      }, this.timeout)
      this.pending.set(request.id, { request, resolve, reject, timer })
      try {
        this.send(request)
      } catch {
        clearTimeout(timer)
        this.pending.delete(request.id)
        reject(new ProofError("unavailable"))
        this.reset()
      }
    })
  }
}
