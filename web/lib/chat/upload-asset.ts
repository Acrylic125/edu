import { z } from "zod"

import { env } from "@/env"

const UploadUrlResponseSchema = z.object({
  assetId: z.string(),
  uploadUrl: z.string(),
  headers: z.object({
    "Content-Type": z.string(),
  }),
})

const CompleteUploadResponseSchema = z.object({
  assetId: z.string(),
})

function apiUrl(path: string) {
  return new URL(path, env.NEXT_PUBLIC_API_URL)
}

async function parseResponse<Schema extends z.ZodType>(
  response: Response,
  schema: Schema
) {
  const json = await response.json()
  if (!response.ok) {
    const errorBody = z.object({ error: z.string() }).safeParse(json)
    if (errorBody.success) {
      throw new Error(errorBody.data.error)
    }
    throw new Error("Upload failed")
  }
  return schema.parse(json)
}

export async function requestAssetUploadUrl(params: {
  token: string
  filename: string
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp"
  size: number
}) {
  const response = await fetch(apiUrl("/assets/upload-url"), {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: params.filename,
      mimeType: params.mimeType,
      size: params.size,
    }),
  })
  return parseResponse(response, UploadUrlResponseSchema)
}

export function putBlobWithProgress(params: {
  url: string
  blob: Blob
  headers: Record<string, string>
  signal: AbortSignal
  onProgress: (progress: number) => void
}) {
  return new Promise<void>((resolve, reject) => {
    if (params.signal.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open("PUT", params.url)
    for (const [key, value] of Object.entries(params.headers)) {
      xhr.setRequestHeader(key, value)
    }

    const onAbort = () => {
      xhr.abort()
    }
    params.signal.addEventListener("abort", onAbort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }
      params.onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      params.signal.removeEventListener("abort", onAbort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      reject(new Error("Upload failed"))
    }
    xhr.onerror = () => {
      params.signal.removeEventListener("abort", onAbort)
      reject(new Error("Upload failed"))
    }
    xhr.onabort = () => {
      params.signal.removeEventListener("abort", onAbort)
      reject(new DOMException("Upload cancelled", "AbortError"))
    }
    xhr.send(params.blob)
  })
}

export async function completeAssetUpload(params: {
  token: string
  assetId: string
}) {
  const response = await fetch(apiUrl(`/assets/${params.assetId}/complete`), {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${params.token}`,
    },
  })
  return parseResponse(response, CompleteUploadResponseSchema)
}
