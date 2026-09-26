import "server-only"
import { query } from "@/lib/db"
import { decrypt, encrypt } from "./crypto"
import { SAXO_TOKEN_URL } from "./config"

const TOKEN_ID = "live"

type TokenRow = {
  access_token_enc: string
  refresh_token_enc: string
  pkce_verifier_enc: string
  access_expires_at: string
  refresh_expires_at: string | null
  token_type: string | null
}

export type SaxoTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
}

export async function saveTokens(t: SaxoTokenResponse, pkceVerifier?: string): Promise<void> {
  const existing = await getRow()
  const now = Date.now()
  const accessExpiresAt = new Date(now + t.expires_in * 1000)
  const refreshExpiresAt = t.refresh_token_expires_in
    ? new Date(now + t.refresh_token_expires_in * 1000)
    : existing?.refresh_expires_at
      ? new Date(existing.refresh_expires_at)
      : null

  const refreshTokenEnc = t.refresh_token
    ? encrypt(t.refresh_token)
    : existing?.refresh_token_enc ?? encrypt("")
  const verifierEnc = pkceVerifier
    ? encrypt(pkceVerifier)
    : existing?.pkce_verifier_enc ?? encrypt("")

  await query(
    `INSERT INTO saxo_tokens (id, access_token_enc, refresh_token_enc, pkce_verifier_enc, access_expires_at, refresh_expires_at, token_type, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       pkce_verifier_enc = EXCLUDED.pkce_verifier_enc,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       token_type = EXCLUDED.token_type,
       updated_at = now()`,
    [TOKEN_ID, encrypt(t.access_token), refreshTokenEnc, verifierEnc,
      accessExpiresAt.toISOString(), refreshExpiresAt?.toISOString() ?? null, t.token_type ?? "Bearer"],
  )
}

async function getRow(): Promise<TokenRow | null> {
  const rows = await query<TokenRow>(
    `SELECT access_token_enc, refresh_token_enc, pkce_verifier_enc, access_expires_at, refresh_expires_at, token_type
     FROM saxo_tokens WHERE id = $1`, [TOKEN_ID],
  )
  return rows[0] ?? null
}

export async function clearTokens(): Promise<void> {
  await query(`DELETE FROM saxo_tokens WHERE id = $1`, [TOKEN_ID])
}

export type ConnectionStatus = { connected: boolean; accessExpiresAt: string | null; refreshExpiresAt: string | null }

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const row = await getRow()
  if (!row) return { connected: false, accessExpiresAt: null, refreshExpiresAt: null }
  const refreshValid = !row.refresh_expires_at || new Date(row.refresh_expires_at) > new Date()
  return { connected: refreshValid, accessExpiresAt: row.access_expires_at, refreshExpiresAt: row.refresh_expires_at }
}

async function refreshWith(refreshToken: string, codeVerifier: string): Promise<SaxoTokenResponse> {
  // Saxo PKCE requires the SAME code_verifier used for the authorization-code exchange.
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    code_verifier: codeVerifier,
  })
  const res = await fetch(SAXO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Saxo token refresh failed (${res.status})`)
  return (await res.json()) as SaxoTokenResponse
}

export async function getValidAccessToken(): Promise<string | null> {
  const row = await getRow()
  if (!row) return null
  const accessExpiresAt = new Date(row.access_expires_at).getTime()
  if (Date.now() < accessExpiresAt - 60_000) return decrypt(row.access_token_enc)

  const refreshToken = decrypt(row.refresh_token_enc)
  const verifier = decrypt(row.pkce_verifier_enc)
  if (!refreshToken || !verifier) return null
  if (row.refresh_expires_at && new Date(row.refresh_expires_at) <= new Date()) return null

  const refreshed = await refreshWith(refreshToken, verifier)
  await saveTokens(refreshed)
  return refreshed.access_token
}
