import { afterEach, expect, test } from "bun:test"
import { EmbeddedSigner } from "../src/embedded"
import {
  MAX_CHANNEL_REQUESTS,
  type Binding,
  type Request,
  type Response,
  type Status,
} from "../src/protocol"

// A controlled DOM/message seam exercises the supported endpoint, including its
// asynchronous continuations. Real DOM, storage and crypto remain browser tests.
const globals = {
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  MutationObserver: Object.getOwnPropertyDescriptor(
    globalThis,
    "MutationObserver",
  ),
}
const endpoints: EmbeddedSigner[] = []
afterEach(() => {
  for (const endpoint of endpoints.splice(0)) endpoint.close()
  for (const [name, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})
function setup(timeout = 100) {
  const origin = "https://signer.example"
  const parent = Object.assign(new EventTarget(), {
    location: { origin: "https://parent.example" },
  })
  let mutated: MutationCallback
  class Observer {
    constructor(callback: MutationCallback) {
      mutated = callback
    }
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: parent,
  })
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: Observer,
  })
  const binding: Binding = {
    pubkey: "a".repeat(64),
    revision: crypto.randomUUID(),
  }
  const status: Status = { frame: crypto.randomUUID(), binding }
  const requests: Request[] = []
  let hold = false
  const frame = Object.assign(new EventTarget(), {
    src: origin + "/",
    isConnected: true,
    ownerDocument: new EventTarget(),
    contentWindow: {
      postMessage(request: Request, target: string) {
        if (target !== origin) throw new Error("wrong target")
        requests.push(request)
        if (!hold) queueMicrotask(() => respond(request))
      },
    },
  })
  function deliver(
    data: unknown,
    source: unknown = frame.contentWindow,
    from = origin,
  ) {
    const event = new Event("message")
    Object.assign(event, { data, source, origin: from })
    parent.dispatchEvent(event)
  }
  function respond(request: Request, changes: Partial<Response> = {}) {
    deliver({
      version: request.version,
      id: request.id,
      channel: request.channel,
      ...status,
      ok: true,
      ...(request.method === "status"
        ? {}
        : {
            value: request.method === "logout" ? null : "synthetic result",
            binding: request.method === "logout" ? null : binding,
          }),
      ...changes,
    })
  }
  const notifications: (Status | null)[] = []
  const endpoint = new EmbeddedSigner(
    frame as unknown as HTMLIFrameElement,
    origin,
    (status) => notifications.push(status),
    timeout,
  )
  endpoints.push(endpoint)
  const operation = {
    method: "encryptNip44" as const,
    peer: binding.pubkey,
    text: "synthetic input",
  }
  async function fill() {
    await endpoint.connect()
    for (let n = 0; n < MAX_CHANNEL_REQUESTS - 2; n++)
      await endpoint.request(operation)
  }
  return {
    endpoint,
    requests,
    binding,
    notifications,
    operation,
    fill,
    hold: () => {
      hold = true
    },
    respond,
    remove: () => {
      frame.isConnected = false
      mutated([], {} as MutationObserver)
    },
  }
}

test("embedded long session renews correlation without replacing account authority", async () => {
  const s = setup()
  await s.endpoint.connect()
  const notices = s.notifications.length
  for (let n = 0; n < MAX_CHANNEL_REQUESTS * 3; n++)
    await s.endpoint.request(s.operation)
  expect(s.notifications.length).toBe(notices)
  expect(s.endpoint.binding?.revision === s.binding.revision).toBe(true)
  expect(new Set(s.requests.map((r) => r.channel)).size).toBe(4)
  await s.endpoint.request({ method: "logout" })
  expect(s.endpoint.binding === null).toBe(true)
})

for (const outcome of [
  "account",
  "frame",
  "malformed",
  "unavailable",
  "timeout",
  "abort",
  "logout",
  "remove",
] as const) {
  test(`embedded renewal fences ${outcome} and its late response`, async () => {
    const s = setup(outcome === "timeout" ? 10 : 100)
    await s.fill()
    s.hold()
    const controller = new AbortController()
    const result = s.endpoint.request(s.operation, controller.signal).then(
      () => "unexpected_success",
      (error) => error.code as string,
    )
    const handshake = s.requests.at(-1)!
    expect(handshake.method).toBe("status")
    const before = s.requests.length
    let expected = "authority_changed"
    if (outcome === "account")
      s.respond(handshake, {
        binding: { ...s.binding, revision: crypto.randomUUID() },
      })
    if (outcome === "frame") {
      expected = "invalid_response"
      s.respond(handshake, { frame: crypto.randomUUID() })
    }
    if (outcome === "malformed") {
      expected = "invalid_response"
      s.respond(handshake, { value: "unexpected" })
    }
    if (outcome === "unavailable") {
      expected = "unavailable"
      s.respond(handshake, { ok: false, binding: null, error: "unavailable" })
    }
    if (outcome === "timeout") expected = "timeout"
    if (outcome === "abort") controller.abort()
    if (outcome === "remove") s.remove()
    if (outcome === "logout") {
      const logout = s.endpoint.request({ method: "logout" })
      s.respond(s.requests.at(-1)!)
      await logout
    }
    expect(await result).toBe(expected)
    expect(s.endpoint.binding === null).toBe(true)
    // The held operation was never sent or retried under another authority.
    expect(s.requests.length).toBe(before + (outcome === "logout" ? 1 : 0))
    s.respond(handshake)
    expect(s.endpoint.binding === null).toBe(true)
  })
}

test("embedded old failure cannot reset a newer connection or logout", async () => {
  const s = setup()
  await s.endpoint.connect()
  s.hold()
  const old = s.endpoint.request(s.operation).catch((error) => error.code)
  const oldRequest = s.requests.at(-1)!
  const fresh = s.endpoint.connect()
  s.respond(s.requests.at(-1)!)
  await fresh
  expect(await old).toBe("authority_changed")
  expect(s.endpoint.binding?.revision === s.binding.revision).toBe(true)
  s.respond(oldRequest)
  expect(s.endpoint.binding?.revision === s.binding.revision).toBe(true)
  const pending = s.endpoint.request(s.operation).catch((error) => error.code)
  const logout = s.endpoint.request({ method: "logout" })
  s.respond(s.requests.at(-1)!)
  expect(await pending).toBe("authority_changed")
  await logout
  expect(s.endpoint.binding === null).toBe(true)
})

test("cancelling a second operation waiting on renewal revokes both waiters", async () => {
  const s = setup()
  await s.fill()
  s.hold()
  const first = s.endpoint.request(s.operation).catch((error) => error.code)
  const controller = new AbortController()
  const second = s.endpoint
    .request(s.operation, controller.signal)
    .catch((error) => error.code)
  controller.abort()
  expect(await first).toBe("authority_changed")
  expect(await second).toBe("authority_changed")
  expect(s.endpoint.binding === null).toBe(true)
})

test("logout supersedes renewal after its reply but before its continuation", async () => {
  const s = setup()
  await s.fill()
  s.hold()
  const before = s.requests.length
  const pending = s.endpoint.request(s.operation).catch((error) => error.code)
  s.respond(s.requests.at(-1)!)
  // Deliver status, then logout in the same task before promise continuations.
  const logout = s.endpoint.request({ method: "logout" })
  const logoutRequest = s.requests.at(-1)!
  expect(await pending).toBe("authority_changed")
  expect(s.requests.length).toBe(before + 2)
  s.respond(logoutRequest)
  await logout
  expect(s.endpoint.binding === null).toBe(true)
})
