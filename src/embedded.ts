import {
  SignerClient,
  SignerError,
  type Operation,
  type Status,
} from "./protocol"

/** Owns one iframe endpoint, not app account authority or a second signer API. */
export class EmbeddedSigner {
  private readonly client: SignerClient
  private closed = false
  private loaded = false
  private connecting: Promise<Status> | null = null
  private generation = 0
  private readonly observer = new MutationObserver((records) => {
    if (!this.frame.isConnected) return this.close()
    if (
      records.some(
        (record) =>
          record.target === this.frame && record.type === "attributes",
      )
    ) {
      this.loaded = false
      this.invalidate()
    }
  })
  constructor(
    private readonly frame: HTMLIFrameElement,
    private readonly origin: string,
    private readonly changed: (
      status: Status | null,
      error?: SignerError,
    ) => void,
    timeout = 3000,
  ) {
    const url = new URL(origin)
    if (
      origin.includes("*") ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost"))
    )
      throw new SignerError("unavailable")
    if (
      new URL(frame.src).origin !== origin ||
      origin === window.location.origin
    )
      throw new SignerError("unavailable")
    this.client = new SignerClient((request) => {
      if (!this.frame.isConnected || !this.frame.contentWindow)
        throw new SignerError("disconnected")
      this.frame.contentWindow.postMessage(request, this.origin)
    }, timeout)
    window.addEventListener("message", this.receive)
    frame.addEventListener("load", this.reload)
    this.observer.observe(frame, { attributes: true, attributeFilter: ["src"] })
  }
  private invalidate() {
    this.generation++
    this.connecting = null
    this.client.reset()
    this.changed(null)
  }
  private reload = () => {
    this.loaded = true
    this.invalidate()
    void this.connect().catch(() => {}) // connect reports the typed failure.
  }
  private receive = (event: MessageEvent) => {
    if (
      this.closed ||
      !this.frame.isConnected ||
      event.origin !== this.origin ||
      event.source !== this.frame.contentWindow
    )
      return
    if (this.client.receiveChange(event.data)) {
      this.invalidate()
      void this.connect().catch(() => {})
    } else this.client.receive(event.data)
  }
  get binding() {
    return this.client.binding
  }
  async connect(signal?: AbortSignal): Promise<Status> {
    if (signal?.aborted) throw new SignerError("authority_changed")
    if (this.closed || !this.frame.isConnected)
      throw new SignerError("disconnected")
    if (new URL(this.frame.src).origin !== this.origin)
      throw new SignerError("unavailable")
    this.loaded = true
    // Containing views can be removed without mutating the iframe's parent.
    this.observer.observe(this.frame.ownerDocument, {
      childList: true,
      subtree: true,
    })
    const aborted = () => this.invalidate()
    signal?.addEventListener("abort", aborted, { once: true })
    try {
      if (this.connecting) return await this.connecting
      const generation = this.generation
      const pending = this.client
        .request({ method: "status" })
        .then((value) => {
          if (this.closed || generation !== this.generation)
            throw new SignerError("authority_changed")
          const status = value as Status
          this.changed(status)
          return status
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof SignerError
              ? error
              : new SignerError("invalid_response")
          if (!this.closed && generation === this.generation)
            this.changed(null, failure)
          throw failure
        })
        .finally(() => {
          if (this.connecting === pending) this.connecting = null
        })
      this.connecting = pending
      return await pending
    } finally {
      signal?.removeEventListener("abort", aborted)
    }
  }
  async request(operation: Operation, signal?: AbortSignal): Promise<unknown> {
    if (this.closed || !this.frame.isConnected || !this.loaded)
      throw new SignerError("disconnected")
    if (operation.method === "status") return this.connect(signal)
    try {
      const result = await this.client.request(operation, signal)
      if (operation.method === "logout") this.invalidate()
      return result
    } catch (error) {
      this.invalidate()
      throw error
    }
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.observer.disconnect()
    window.removeEventListener("message", this.receive)
    this.frame.removeEventListener("load", this.reload)
    this.invalidate()
    this.client.close()
  }
}
