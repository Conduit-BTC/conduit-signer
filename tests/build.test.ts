import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("supported build contains only the signer, with no fixture controls or parent probes", () => {
  const output = mkdtempSync(join(tmpdir(), "signer-build-"))
  try {
    mkdirSync(join(output, "signer"))
    writeFileSync(join(output, "signer/fixture.js"), "stale test equipment")
    const result = spawnSync("bun", ["proof/server.ts", "--build"], {
      env: { PATH: process.env.PATH, PROOF_OUTPUT_DIR: output },
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(readdirSync(output)).toEqual(["signer"])
    const files = readdirSync(join(output, "signer"))
    expect(files.includes("fixture.js")).toBe(false)
    expect(files.includes("host.js")).toBe(false)
    const html = readFileSync(join(output, "signer/index.html"), "utf8")
    expect(html.includes("Import NSEC")).toBe(true)
    expect(/disposable|prototype|fixture|checkbox|test key/i.test(html)).toBe(
      false,
    )
    expect(html.includes('autocomplete="off"')).toBe(true)
    const headers = readFileSync(join(output, "signer/_headers"), "utf8")
    expect(
      headers.includes(
        "frame-ancestors http://localhost:7030 http://localhost:7031;",
      ),
    ).toBe(true)
    expect(headers.includes("Access-Control-Allow-Origin")).toBe(false)
    const worker = readFileSync(join(output, "signer/sw.js"), "utf8")
    expect(worker.includes("fixture.js")).toBe(false)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test("preview build requires an explicit complete exact HTTPS origin triple", () => {
  const output = mkdtempSync(join(tmpdir(), "signer-preview-build-"))
  try {
    for (const config of [
      {},
      {
        PROOF_MARKET_ORIGIN: "https://*.example.test",
        PROOF_MERCHANT_ORIGIN: "https://merchant.example.test",
        PROOF_SIGNER_ORIGIN: "https://signer.example.test",
      },
      {
        PROOF_MARKET_ORIGIN: "https://market.example.test/path",
        PROOF_MERCHANT_ORIGIN: "https://merchant.example.test",
        PROOF_SIGNER_ORIGIN: "https://signer.example.test",
      },
      {
        PROOF_MARKET_ORIGIN: "https://market.example.test",
        PROOF_MERCHANT_ORIGIN: "https://merchant.example.test",
        PROOF_SIGNER_ORIGIN: "http://localhost:7032",
      },
    ]) {
      const result = spawnSync(
        "bun",
        ["proof/server.ts", "--build", "--preview"],
        {
          env: { PATH: process.env.PATH, PROOF_OUTPUT_DIR: output, ...config },
          stdio: "ignore",
        },
      )
      expect(result.status).not.toBe(0)
    }
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
