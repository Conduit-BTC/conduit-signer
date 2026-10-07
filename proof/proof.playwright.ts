import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { EmbeddedSigner } from "../src/embedded"

test("exact parent origin and source are required; parent ignores forged changes", async ({
  page,
}) => {
  await page.goto("http://localhost:7030")
  const frame = page.frames().find((f) => f.url() === "http://localhost:7032/")!
  await expect(page.frameLocator("iframe").locator("#state")).toContainText(
    "No stored record",
  )
  await page.evaluate(() => {
    const root = window as Window & { proofResponses?: number }
    root.proofResponses = 0
    window.addEventListener("message", (e) => {
      if (e.data?.id === "boundary-test") root.proofResponses!++
    })
  })
  const request = {
    version: "conduit-signer-proof-1",
    id: "boundary-test",
    channel: "boundary-test",
    frame: null,
    binding: null,
    method: "status",
  }
  await frame.evaluate((data) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: "https://unapproved.example",
        source: window.parent,
      }),
    )
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: "http://localhost:7030",
        source: window,
      }),
    )
  }, request)
  await page.waitForTimeout(100)
  expect(
    await page.evaluate(
      () => (window as Window & { proofResponses?: number }).proofResponses,
    ),
  ).toBe(0)
  await page.evaluate(
    (data) =>
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage(data, "http://localhost:7032"),
    request,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { proofResponses?: number }).proofResponses,
      ),
    )
    .toBe(1)
  await page.getByRole("button", { name: "Check status" }).click()
  await expect(page.locator("#result")).toContainText("Disconnected")
  await page.evaluate(() => {
    const data = { version: "conduit-signer-proof-1", changed: true }
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: "https://unapproved.example",
        source: document.querySelector("iframe")!.contentWindow,
      }),
    )
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: "http://localhost:7032",
        source: window,
      }),
    )
  })
  await expect(page.locator("#result")).toContainText("Disconnected")
})

test("headers bound embedding and server rejects data-bearing requests", async ({
  request,
}) => {
  const signer = await request.get("http://localhost:7032")
  const policy = signer.headers()["content-security-policy"]
  expect(
    policy.includes(
      "frame-ancestors http://localhost:7030 http://localhost:7031;",
    ),
  ).toBe(true)
  expect(policy.includes("form-action 'none'")).toBe(true)
  expect(signer.headers()["access-control-allow-origin"]).toBeUndefined()
  expect((await request.post("http://localhost:7032")).status()).toBe(404)
  expect((await request.get("http://localhost:7032/?invalid=1")).status()).toBe(
    404,
  )
})

for (const [name, port] of [
  ["Market", 7030],
  ["Merchant", 7031],
] as const) {
  test(`${name}: isolated import, restore, crypto, offline, logout and reimport`, async ({
    page,
    context,
  }) => {
    const requests: { origin: string; method: string; query: boolean }[] = []
    page.on("request", (r) => {
      const u = new URL(r.url())
      requests.push({ origin: u.origin, method: r.method(), query: !!u.search })
    })
    await page.goto(`http://localhost:${port}`)
    let signer = page.frameLocator("iframe")
    await expect(signer.locator("#state")).toContainText("No stored record")
    await signer
      .getByRole("button", { name: "Prepare disposable import" })
      .click()

    await signer.getByRole("button", { name: "Import NSEC" }).click()
    await expect(signer.locator("#state")).toContainText(
      "Stored record available",
    )
    expect(
      await page.evaluate(
        () => document.querySelector("iframe")!.contentDocument === null,
      ),
    ).toBe(true)
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0)
    await page.getByRole("button", { name: "Check status" }).click()
    await expect(page.locator("#result")).toContainText("Connected")
    await page.getByRole("button", { name: "Verify signing" }).click()
    await expect(page.locator("#result")).toContainText("PASS: exact template")
    await page.getByRole("button", { name: "Verify NIP-44" }).click()
    await expect(page.locator("#result")).toContainText("PASS: NIP-44")
    await page.getByRole("button", { name: "Replace signer frame" }).click()
    signer = page.frameLocator("iframe")
    await expect(signer.locator("#state")).toContainText(
      "Stored record available",
    )
    await page.reload()
    await expect(signer.locator("#state")).toContainText(
      "Stored record available",
    )
    await page.getByRole("button", { name: "Check status" }).click()
    await expect(page.locator("#result")).toContainText("Connected")
    await context.setOffline(true)
    await page.getByRole("button", { name: "Verify NIP-44" }).click()
    await expect(page.locator("#result")).toContainText("PASS: NIP-44")
    await context.setOffline(false)
    await page.getByRole("button", { name: "Log out signer" }).click()
    await expect(page.locator("#result")).toContainText("Logged out")
    await page.reload()
    await expect(signer.locator("#state")).toContainText("No stored record")
    await page.getByRole("button", { name: "Check status" }).click()
    await expect(page.locator("#result")).toContainText("Disconnected")
    await signer
      .getByRole("button", { name: "Prepare disposable import" })
      .click()

    await signer.getByRole("button", { name: "Import NSEC" }).click()
    await expect(signer.locator("#state")).toContainText(
      "Stored record available",
    )
    await page.getByRole("button", { name: "Check status" }).click()
    await page.getByRole("button", { name: "Verify signing" }).click()
    await expect(page.locator("#result")).toContainText("PASS: exact template")
    expect(
      requests.every(
        (r) =>
          [
            "http://localhost:7030",
            "http://localhost:7031",
            "http://localhost:7032",
          ].includes(r.origin) &&
          r.method === "GET" &&
          !r.query,
      ),
    ).toBe(true)
    await signer.getByRole("button", { name: "Log out and remove key" }).click()
  })
}

for (const [name, port] of [
  ["Market", 7060],
  ["Merchant", 7061],
] as const) {
  test(`${name}: actual server outage restores signer and offline authority`, async ({
    page,
    context,
  }) => {
    const output = await mkdtemp(join(tmpdir(), "conduit-signer-proof-"))
    const child = spawn(
      "bun",
      [fileURLToPath(new URL("./server.ts", import.meta.url)), "--harness"],
      {
        stdio: "ignore",
        env: {
          PATH: process.env.PATH,
          PROOF_MARKET_ORIGIN: "http://localhost:7060",
          PROOF_MARKET_PORT: "7060",
          PROOF_MERCHANT_ORIGIN: "http://localhost:7061",
          PROOF_MERCHANT_PORT: "7061",
          PROOF_SIGNER_ORIGIN: "http://localhost:7062",
          PROOF_SIGNER_PORT: "7062",
          PROOF_OUTPUT_DIR: output,
        },
      },
    )
    try {
      await expect
        .poll(async () => {
          try {
            return (await fetch("http://localhost:7060")).ok
          } catch {
            return false
          }
        })
        .toBe(true)
      await page.goto(`http://localhost:${port}`)
      const frame = page.frameLocator("iframe")
      await frame
        .getByRole("button", { name: "Prepare disposable import" })
        .click()

      await frame.getByRole("button", { name: "Import NSEC" }).click()
      await expect(frame.locator("#state")).toContainText(
        "Stored record available",
      )
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await page
        .frames()
        .find((f) => f.url() === "http://localhost:7062/")!
        .evaluate(async () => {
          await navigator.serviceWorker.ready
        })
      await page.reload()
      await expect(frame.locator("#state")).toContainText(
        "Stored record available",
      )
      const stopped = once(child, "exit")
      child.kill("SIGTERM")
      await stopped
      await page.reload()
      await expect(frame.locator("#state")).toContainText(
        "Stored record available",
      )
      await page.getByRole("button", { name: "Check status" }).click()
      await expect(page.locator("#result")).toContainText("Connected")
      await page.getByRole("button", { name: "Verify signing" }).click()
      await expect(page.locator("#result")).toContainText(
        "PASS: exact template",
      )
      await page.getByRole("button", { name: "Verify NIP-44" }).click()
      await expect(page.locator("#result")).toContainText("PASS: NIP-44")
      await page.getByRole("button", { name: "Replace signer frame" }).click()
      await expect(frame.locator("#state")).toContainText(
        "Stored record available",
      )
      await page.getByRole("button", { name: "Check status" }).click()
      await expect(page.locator("#result")).toContainText("Connected")
      await page.close()
      const relaunched = await context.newPage()
      await relaunched.goto(`http://localhost:${port}`)
      const restored = relaunched.frameLocator("iframe")
      await expect(restored.locator("#state")).toContainText(
        "Stored record available",
      )
      await relaunched.getByRole("button", { name: "Check status" }).click()
      await expect(relaunched.locator("#result")).toContainText("Connected")
      await relaunched.getByRole("button", { name: "Verify signing" }).click()
      await expect(relaunched.locator("#result")).toContainText(
        "PASS: exact template",
      )
      await relaunched.getByRole("button", { name: "Verify NIP-44" }).click()
      await expect(relaunched.locator("#result")).toContainText("PASS: NIP-44")
      await relaunched.getByRole("button", { name: "Log out signer" }).click()
      await expect(relaunched.locator("#result")).toContainText("Logged out")
      await relaunched.reload()
      await expect(restored.locator("#state")).toContainText("No stored record")
      await restored
        .getByRole("button", { name: "Prepare disposable import" })
        .click()

      await restored.getByRole("button", { name: "Import NSEC" }).click()
      await relaunched.getByRole("button", { name: "Check status" }).click()
      await relaunched.getByRole("button", { name: "Verify signing" }).click()
      await expect(relaunched.locator("#result")).toContainText(
        "PASS: exact template",
      )
      await relaunched.getByRole("button", { name: "Log out signer" }).click()
      await expect(relaunched.locator("#result")).toContainText("Logged out")
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit")
        child.kill("SIGTERM")
        await stopped
      }
      await rm(output, { recursive: true, force: true })
    }
  })
}
test("same storage partition logout revokes the other view", async ({
  context,
}) => {
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto("http://localhost:7030")
  await b.goto("http://localhost:7030")
  const frame = a.frameLocator("iframe")
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()

  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(frame.locator("#state")).toContainText("Stored record available")
  for (const p of [a, b]) {
    await p.getByRole("button", { name: "Check status" }).click()
    await expect(p.locator("#result")).toContainText("Connected")
  }
  await a.getByRole("button", { name: "Log out signer" }).click()
  await expect(a.locator("#result")).toContainText("Logged out")
  await expect(b.locator("#result")).toContainText("Disconnected")
  await b.getByRole("button", { name: "Verify signing" }).click()
  await expect(b.locator("#result")).toContainText("disconnected")
})

test("ordinary input rejects invalid NSEC and storage failures without enabling signing", async ({
  page,
}) => {
  await page.goto("http://localhost:7030")
  const frame = page.frameLocator("iframe")
  await frame.locator("#nsec").fill("invalid input")
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(frame.locator("#state")).toContainText("Invalid NSEC")
  await expect(frame.locator("#nsec")).toHaveValue("")
  await page.getByRole("button", { name: "Verify signing" }).click()
  await expect(page.locator("#result")).toContainText("disconnected")
  await page
    .frames()
    .find((f) => f.url() === "http://localhost:7032/")!
    .evaluate(() => {
      indexedDB.open = () => {
        throw new DOMException("blocked", "SecurityError")
      }
    })
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(frame.locator("#state")).toContainText("Storage unavailable")
  await expect(frame.locator("#nsec")).toHaveValue("")
  await page.getByRole("button", { name: "Check status" }).click()
  await expect(page.locator("#result")).toContainText("unavailable")
  await page.reload()
  await expect(frame.locator("#state")).toContainText("No stored record")
})

test("same partition account replacement automatically revokes and reconnects both endpoints", async ({
  context,
}) => {
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto("http://localhost:7030")
  await b.goto("http://localhost:7030")
  const frame = a.frameLocator("iframe")
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  for (const p of [a, b])
    await expect(p.locator("#result")).toContainText("Connected")
  // Compare public identity only, and return a boolean rather than record it.
  await b.evaluate(() => {
    const root = window as Window & {
      harness?: { binding: { pubkey: string } | null }
      previousPublicKey?: string
    }
    root.previousPublicKey = root.harness!.binding!.pubkey
  })
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect
    .poll(() =>
      b.evaluate(() => {
        const root = window as Window & {
          harness?: { binding: { pubkey: string } | null }
          previousPublicKey?: string
        }
        return (
          !!root.harness?.binding &&
          root.harness.binding.pubkey !== root.previousPublicKey
        )
      }),
    )
    .toBe(true)
  await b.getByRole("button", { name: "Verify signing" }).click()
  await expect(b.locator("#result")).toContainText("PASS: exact template")
  await frame.getByRole("button", { name: "Log out and remove key" }).click()
  for (const p of [a, b])
    await expect(p.locator("#result")).toContainText("Disconnected")
})

test("failed embedded logout stays unavailable after storage recovers until cleanup", async ({
  page,
}) => {
  await page.goto("http://localhost:7030")
  const frame = page.frameLocator("iframe")
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(page.locator("#result")).toContainText("Connected")
  const signer = page
    .frames()
    .find((f) => f.url() === "http://localhost:7032/")!
  await signer.evaluate(() => {
    const root = window as Window & { storageBlocked?: boolean }
    const original = indexedDB.open.bind(indexedDB)
    root.storageBlocked = true
    indexedDB.open = (...args) => {
      if (root.storageBlocked)
        throw new DOMException("blocked", "SecurityError")
      return original(...args)
    }
  })
  await page.getByRole("button", { name: "Log out signer" }).click()
  await expect(page.locator("#result")).toContainText("unavailable")
  await signer.evaluate(() => {
    ;(window as Window & { storageBlocked?: boolean }).storageBlocked = false
  })
  await page.getByRole("button", { name: "Check status" }).click()
  await expect(page.locator("#result")).toContainText("unavailable")
  await page.getByRole("button", { name: "Verify signing" }).click()
  await expect(page.locator("#result")).toContainText("disconnected")
  await frame.getByRole("button", { name: "Log out and remove key" }).click()
  await expect(frame.locator("#state")).toContainText("No stored record")
  // Failed status invalidates the channel. Retry discovery after cleanup;
  // credential deletion alone cannot revive that cancelled connection attempt.
  await page.getByRole("button", { name: "Check status" }).click()
  await expect(page.locator("#result")).toContainText("Disconnected")
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(page.locator("#result")).toContainText("Connected")
  await page.getByRole("button", { name: "Verify signing" }).click()
  await expect(page.locator("#result")).toContainText("PASS: exact template")
})

test("status cancellation rejects aborted and coalesced handshakes and ignores late restoration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const root = window as Window & {
      watchStatus?: boolean
      lateStatusObserved?: boolean
    }
    window.addEventListener("message", (event) => {
      if (
        root.watchStatus &&
        event.origin === "http://localhost:7032" &&
        event.source === document.querySelector("iframe")?.contentWindow &&
        event.data?.ok === true &&
        !("value" in event.data)
      )
        root.lateStatusObserved = true
    })
  })
  await page.goto("http://localhost:7030")
  const frame = page.frameLocator("iframe")
  await frame.getByRole("button", { name: "Prepare disposable import" }).click()
  await frame.getByRole("button", { name: "Import NSEC" }).click()
  await expect(page.locator("#result")).toContainText("Connected")
  const codes = await page.evaluate(async () => {
    const root = window as Window & {
      harness?: EmbeddedSigner
      watchStatus?: boolean
    }
    const endpoint = root.harness!
    const controller = new AbortController()
    controller.abort()
    const aborted = await endpoint
      .request({ method: "status" }, controller.signal)
      .then(
        () => "unexpected_success",
        (e) => e.code,
      )
    root.watchStatus = true
    const coalescedController = new AbortController()
    const original = endpoint.connect().then(
      () => "unexpected_success",
      (e) => e.code,
    )
    const coalesced = endpoint
      .request({ method: "status" }, coalescedController.signal)
      .then(
        () => "unexpected_success",
        (e) => e.code,
      )
    coalescedController.abort()
    return [aborted, await original, await coalesced]
  })
  expect(codes).toEqual([
    "authority_changed",
    "authority_changed",
    "authority_changed",
  ])
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { lateStatusObserved?: boolean })
            .lateStatusObserved === true,
      ),
    )
    .toBe(true)
  expect(
    await page.evaluate(
      () =>
        (window as Window & { harness?: EmbeddedSigner }).harness!.binding ===
        null,
    ),
  ).toBe(true)
  await expect(page.locator("#result")).toContainText("Disconnected")
  await page.getByRole("button", { name: "Check status" }).click()
  await expect(page.locator("#result")).toContainText("Connected")
  await page.getByRole("button", { name: "Verify signing" }).click()
  await expect(page.locator("#result")).toContainText("PASS: exact template")
})

for (const removal of ["frame", "containing view"] as const) {
  test(`detaching the ${removal} cancels a pending real signature and discards its response`, async ({
    page,
  }) => {
    // Register before the endpoint listener: Chromium's Window message delivery
    // preserves registration order even for a later capture listener.
    await page.addInitScript((removal) => {
      const root = window as Window & {
        removalArmed?: boolean
        signatureObserved?: boolean
      }
      window.addEventListener(
        "message",
        (event) => {
          const frame = document.querySelector("iframe")
          if (
            !root.removalArmed ||
            !frame ||
            event.origin !== "http://localhost:7032" ||
            event.source !== frame.contentWindow ||
            !event.data?.value?.sig
          )
            return
          root.signatureObserved = true
          root.removalArmed = false
          event.stopImmediatePropagation()
          if (removal === "frame") frame.remove()
          else document.querySelector("#mount")!.remove()
        },
        true,
      )
    }, removal)
    await page.goto("http://localhost:7030")
    const frame = page.frameLocator("iframe")
    await frame
      .getByRole("button", { name: "Prepare disposable import" })
      .click()
    await frame.getByRole("button", { name: "Import NSEC" }).click()
    await expect(page.locator("#result")).toContainText("Connected")
    const outcome = await page.evaluate(async () => {
      const root = window as Window & {
        removalArmed?: boolean
        signatureObserved?: boolean
        harness?: {
          binding: { pubkey: string } | null
          request: (op: unknown) => Promise<unknown>
        }
      }
      const endpoint = root.harness!
      root.removalArmed = true
      const code = await endpoint
        .request({
          method: "signEvent",
          event: {
            kind: 1,
            pubkey: endpoint.binding!.pubkey,
            created_at: 1,
            tags: [],
            content: "Never published",
          },
        })
        .then(
          () => "unexpected_success",
          (error) => error.code,
        )
      return {
        observedSignature: root.signatureObserved === true,
        code,
        disconnected: endpoint.binding === null,
      }
    })
    expect(outcome).toEqual({
      observedSignature: true,
      code: "authority_changed",
      disconnected: true,
    })
  })
}
