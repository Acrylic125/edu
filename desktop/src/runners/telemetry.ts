import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ROOT_CONTEXT, SpanStatusCode, trace, type Attributes, type Context, type SpanContext } from "@opentelemetry/api"
import { ExportResultCode } from "@opentelemetry/core"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BasicTracerProvider, SimpleSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base"
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer"
import { OpenInferenceSpanKind, SemanticConventions, SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions"

export async function installPhoenixExporter(resources: string, workspace: string) {
  try {
    const directory = join(workspace, "phoenix")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const file of ["export_traces.py", "export_traces.py.lock", "README.md"])
      await copyFile(join(resources, file), join(directory, file))
    return true
  } catch {
    return false
  }
}

export class FileSpanExporter implements SpanExporter {
  private writes = Promise.resolve()
  private failed = false

  constructor(private directory: string) {}

  export(...[spans, callback]: Parameters<SpanExporter["export"]>) {
    this.writes = this.writes.then(async () => {
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      try {
        const body = ProtobufTraceSerializer.serializeRequest(spans)
        if (!body) throw new Error("Could not serialize trace")
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        await writeFile(temporary, body, { mode: 0o600 })
        await rename(temporary, temporary.replace(/\.tmp$/, ".otlp"))
        callback({ code: ExportResultCode.SUCCESS })
      } catch {
        this.failed = true
        callback({ code: ExportResultCode.FAILED, error: new Error("Could not write Phoenix trace files.") })
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  async shutdown() {
    await this.writes
    if (this.failed) throw new Error("Could not write Phoenix trace files.")
  }
}

export class TurnTelemetry {
  private contexts = new AsyncLocalStorage<Context>()
  private provider
  private tracer
  private root
  private rootContext
  private completion: Promise<void> | undefined

  constructor(options: {
    directory: string
    name: string
    parent?: SpanContext
    attributes?: Attributes
    exporter?: SpanExporter
  }) {
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ "service.name": "edu-desktop", [SEMRESATTRS_PROJECT_NAME]: "EdU" }),
      spanProcessors: [new SimpleSpanProcessor(options.exporter ?? new FileSpanExporter(options.directory))],
    })
    this.tracer = this.provider.getTracer("edu-tutor")
    let parent = ROOT_CONTEXT
    if (options.parent) parent = trace.setSpanContext(parent, { ...options.parent, isRemote: true })
    this.root = this.tracer.startSpan(options.name, {
      attributes: { ...options.attributes, [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.CHAIN },
    }, parent)
    this.rootContext = trace.setSpan(parent, this.root)
  }

  get context() {
    return this.root.spanContext()
  }

  capture() {
    return this.contexts.getStore() ?? this.rootContext
  }

  within<Result>(context: Context, operation: () => Result) {
    return this.contexts.run(context, operation)
  }

  async span<Result>(name: string, kind: keyof typeof OpenInferenceSpanKind, operation: () => Result | Promise<Result>, attributes: Attributes = {}) {
    const parent = this.contexts.getStore() ?? this.rootContext
    const span = this.tracer.startSpan(name, {
      attributes: { ...attributes, [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind[kind] },
    }, parent)
    return this.contexts.run(trace.setSpan(parent, span), async () => {
      try {
        const result = await operation()
        return result
      } catch (error) {
        // Provider/tool exceptions can include learner content and credentials.
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    })
  }

  reject() {
    trace.getSpan(this.contexts.getStore() ?? this.rootContext)?.setStatus({ code: SpanStatusCode.ERROR })
  }

  finish(failed = false) {
    if (!this.completion) {
      this.root.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK })
      this.root.end()
      this.completion = this.provider.forceFlush().finally(() => this.provider.shutdown())
    }
    return this.completion
  }
}
