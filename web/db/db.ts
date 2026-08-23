import { drizzle } from "drizzle-orm/sqlite-proxy"
import type {
  AsyncBatchRemoteCallback,
  AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy"

import { env } from "@/env"

import * as schema from "./schema"

const { CLOUDFLARE_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID } = env

const D1_API_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_DATABASE_ID}`

const d1HttpDriver = async (
  sql: string,
  params: unknown[],
  method: "all" | "run" | "get"
) => {
  const res = await fetch(`${D1_API_BASE_URL}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params, method }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Error from D1 HTTP API: ${res.status} ${res.statusText}\n${text}`
    )
  }

  const data = (await res.json()) as {
    success: boolean
    errors: unknown[]
    result: Array<{
      success: boolean
      results: Array<Record<string, unknown>>
    }>
  }

  if (data.errors?.length || !data.success) {
    throw new Error(`Error from D1 HTTP API: ${JSON.stringify(data, null, 2)}`)
  }

  const qResult = data.result?.[0]

  if (!qResult?.success) {
    throw new Error(
      `Error from D1 HTTP API result: ${JSON.stringify(qResult, null, 2)}`
    )
  }

  return {
    rows: qResult.results.map((row) => Object.values(row)),
  }
}

const wrappedDriver: AsyncRemoteCallback = async (sql, params, method) => {
  if (method === "values") {
    return d1HttpDriver(sql, params, "all")
  }

  return d1HttpDriver(sql, params, method)
}

const wrappedBatchDriver: AsyncBatchRemoteCallback = async (batch) => {
  const res = await fetch(`${D1_API_BASE_URL}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      batch: batch.map((q) => ({
        sql: q.sql,
        params: q.params ?? [],
      })),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Error from D1 HTTP API: ${res.status} ${res.statusText}\n${text}`
    )
  }

  const data = (await res.json()) as {
    success: boolean
    errors?: unknown[]
    result: Array<{
      success: boolean
      results?: Array<Record<string, unknown>>
    }>
  }

  if (!data.success || data.errors?.length) {
    throw new Error(`D1 batch error: ${JSON.stringify(data, null, 2)}`)
  }

  return data.result.map((stmtResult, i) => {
    if (!stmtResult.success) {
      throw new Error(
        `Statement failed: ${JSON.stringify(stmtResult, null, 2)}`
      )
    }

    const method = batch[i].method

    if (method === "run") {
      return { rows: [] }
    }

    const rows = stmtResult.results?.map((row) => Object.values(row)) ?? []

    return { rows }
  })
}

const db = drizzle(wrappedDriver, wrappedBatchDriver, { schema })

export default db
