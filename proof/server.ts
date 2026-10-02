import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const directory = import.meta.dir
function exactOrigin(value: string): string {
  const u = new URL(value)
  if (
    u.origin !== value ||
    u.username ||
    u.password ||
    (u.protocol !== "https:" &&
      !(u.protocol === "http:" && u.hostname === "localhost"))
  )
    throw new Error("Use exact HTTPS origins, or localhost for local checks")
  return u.origin
}
const market = exactOrigin(
  process.env.PROOF_MARKET_ORIGIN ?? "http://localhost:7030",
)
const merchant = exactOrigin(
  process.env.PROOF_MERCHANT_ORIGIN ?? "http://localhost:7031",
)
const signer = exactOrigin(
  process.env.PROOF_SIGNER_ORIGIN ?? "http://localhost:7032",
)
if (new Set([market, merchant, signer]).size !== 3)
  throw new Error("Three distinct origins required")
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll(/"/g, "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
const css =
  ":root{color-scheme:light dark;font-family:system-ui}body{max-width:48rem;margin:1.5rem auto;padding:0 1rem;line-height:1.5}button,input{font:inherit;padding:.7rem;margin:.3rem;min-height:44px}input[type=password]{display:block;width:90%}iframe{width:100%;height:32rem;border:2px solid currentColor}output{display:block;padding:1rem;border:1px solid currentColor;overflow-wrap:anywhere}fieldset{margin:1rem 0}code{overflow-wrap:anywhere}button:focus-visible,input:focus-visible{outline:3px solid Highlight}"
const top = (title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="apple-mobile-web-app-capable" content="yes"><title>${title}</title><link rel="stylesheet" href="/proof.css">`
const host = (name: string) =>
  `${top(name)}<link rel="manifest" href="/manifest.webmanifest"></head><body data-signer="${escape(signer)}"><h1>${name}</h1><p>Feasibility harness only. No real accounts, payments or relay delivery.</p><p id="mode"></p><p><code id="origins"></code></p><p>Safari and installed apps may use separate storage and require separate imports. This check does not assume sharing.</p><div id="mount"></div><fieldset><legend>Checks</legend><button id="status">Check status</button><button id="sign">Verify signing</button><button id="encrypt">Verify NIP-44</button><button id="reload">Replace signer frame</button><button id="logout">Log out signer</button></fieldset><output id="result" aria-live="polite">Loading</output><script type="module" src="/host.js"></script></body></html>`
const signerHtml = `${top("Disposable signer proof")}</head><body data-parents="${escape(JSON.stringify([market, merchant]))}"><h1>Disposable signer proof</h1><p>Import happens at <strong id="origin"></strong>. Never use a real account key.</p><p>This prototype stores the test key in this origin's IndexedDB without password protection. It is not a production signer.</p><button id="fixture">Prepare disposable import</button><form id="import"><label for="nsec">Disposable test nsec</label><input id="nsec" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required><label><input id="disposable" type="checkbox" required>I confirm this is a disposable test key.</label><button type="submit">Import test key</button></form><button id="forget">Forget local test key</button><output id="state" aria-live="polite">Checking storage</output><p id="offline"></p><p>Logout removes the active record; it does not erase forensic copies or device backups. Reimport is required after storage loss.</p><script type="module" src="/signer.js"></script></body></html>`

const bundled = await Bun.build({
  entrypoints: [resolve(directory, "host.ts"), resolve(directory, "signer.ts")],
  target: "browser",
  minify: true,
  sourcemap: "none",
})
if (!bundled.success) throw new Error("Proof bundle failed")
const scripts = new Map(
  await Promise.all(
    bundled.outputs.map(
      async (o) => [o.path.split("/").at(-1)!, await o.text()] as const,
    ),
  ),
)
function worker(paths: string[]) {
  // Caches only these public static files; never messages, keys, requests or results.
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        market,
        merchant,
        signer,
        signerHtml,
        css,
        ...scripts.values(),
      ]),
    )
    .digest("hex")
    .slice(0, 16)
  return `const CACHE="signer-proof-${revision}";const PATHS=${JSON.stringify(paths)};self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PATHS)).then(()=>self.skipWaiting()))});self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("signer-proof-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==self.location.origin||u.search||!PATHS.includes(u.pathname))return;e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||Response.error())))});`
}
type Surface = "market" | "merchant" | "signer"
const output = resolve(process.env.PROOF_OUTPUT_DIR ?? "dist")
for (const surface of ["market", "merchant", "signer"] as Surface[]) {
  const isSigner = surface === "signer"
  const script = isSigner ? "signer.js" : "host.js"
  const manifest = JSON.stringify({
    id: "/",
    name: `${surface} signer feasibility`,
    short_name: `${surface} proof`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  })
  const files: Record<string, string> = {
    "/": isSigner
      ? signerHtml
      : host(
          `${surface === "market" ? "Market" : "Merchant"} signer feasibility`,
        ),
    [`/${script}`]: scripts.get(script)!,
    "/proof.css": css,
    "/sw.js": worker([
      "/",
      `/${script}`,
      "/proof.css",
      ...(isSigner ? [] : ["/manifest.webmanifest", "/icon.svg"]),
    ]),
    ...(!isSigner
      ? {
          "/manifest.webmanifest": manifest,
          "/icon.svg":
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="black"/><text x="48" y="130" font-size="100" fill="white">T</text></svg>',
        }
      : {}),
  }
  const headers = {
    "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'; frame-src ${isSigner ? "'none'" : signer}; frame-ancestors ${isSigner ? `${market} ${merchant}` : "'none'"}; base-uri 'none'; form-action 'none'; object-src 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  }
  await mkdir(resolve(output, surface), { recursive: true })
  for (const [path, text] of Object.entries(files))
    await Bun.write(
      resolve(output, surface, path === "/" ? "index.html" : path.slice(1)),
      text,
    )
  await Bun.write(
    resolve(output, surface, "_headers"),
    `/*\n${Object.entries(headers)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n")}\n`,
  )
  if (!process.argv.includes("--build")) {
    const port = Number(
      process.env[`PROOF_${surface.toUpperCase()}_PORT`] ??
        { market: 7030, merchant: 7031, signer: 7032 }[surface],
    )
    Bun.serve({
      hostname: "localhost",
      port,
      fetch(request) {
        const url = new URL(request.url)
        const intended = { market, merchant, signer }[surface]
        if (![intended, `http://localhost:${port}`].includes(url.origin))
          return new Response(null, { status: 421 })
        if (
          !["GET", "HEAD"].includes(request.method) ||
          url.search ||
          !(url.pathname in files)
        )
          return new Response(null, { status: 404, headers })
        const type = url.pathname.endsWith(".js")
          ? "text/javascript"
          : url.pathname.endsWith(".css")
            ? "text/css"
            : url.pathname.endsWith(".webmanifest")
              ? "application/manifest+json"
              : url.pathname.endsWith(".svg")
                ? "image/svg+xml"
                : "text/html"
        return new Response(
          request.method === "HEAD" ? null : files[url.pathname],
          { headers: { ...headers, "Content-Type": type } },
        )
      },
    })
  }
}
console.info(
  process.argv.includes("--build")
    ? "Built three isolated proof surfaces; nothing deployed."
    : "Disposable signer proof: Market localhost:7030; Merchant localhost:7031; signer localhost:7032. No relay access.",
)
