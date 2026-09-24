# Saxo Market Bridge — project status

Updated: 2026-09-23

## Working state
- Production app: https://saxo-market-data-dashboard.vercel.app
- Read-only Saxo LIVE integration; no order/trading endpoints.
- OAuth PKCE login works.
- Secure token storage/refresh is configured.
- Saxo OpenAPI market-data access has been enabled by the account holder.
- Diagnostic now reports `marketDataViaOpenApiTermsAccepted: true`.
- The previous `/chart/v3/charts` HTTP 403 Access denied issue is resolved.
- LIVE chart data is loading for both DAX / Germany 40 and Nasdaq / US Tech 100.
- Current resolved instruments shown by dashboard:
  - DAX / Germany 40: CfdOnIndex, UIC 4910
  - Nasdaq / US Tech 100: CfdOnIndex, UIC 4912

## Trading dashboard requirements
DAX:
- ORB: 09:00–09:15 Europe/Copenhagen.
- Show ORB high/low, Asian high/low, previous-day high/low, M5 EMA8/21, H1 EMA8/21.

Nasdaq:
- ORB: 09:30–09:45 America/New_York (DST-safe).
- Show ORB high/low, Asian high/low, previous-day high/low, M5 EMA8/21, H1 EMA8/21.

General:
- Read-only market data only.
- Never place orders via API.
- Trade analysis should combine market levels with separately verified macro/fundamental context.
- Do not force a trade.

## Next quality checks
1. Validate DAX and Nasdaq ORB calculations against raw Saxo candles.
2. Validate Asian-session definition/timezone.
3. Validate previous-day high/low session boundaries. On 2026-09-23 the Nasdaq card displayed Previous Day as 2026-09-21, which needs investigation before relying on PDH/PDL.
4. Validate M5 and H1 EMA8/EMA21 values against raw candle closes.
5. Fix mobile layout where EMA values visually overlap.
6. Once calculations are validated, expose a safe read-only endpoint suitable for ChatGPT analysis.

## Security
Do not commit or display Saxo access tokens, refresh tokens, OAuth authorization codes, passwords, TOKEN_ENCRYPTION_KEY, database credentials, or other secrets.

## Validation update — 2026-09-23
- ORB verified from exact M5 candles: DAX 09:00/09:05/09:10 Europe/Copenhagen; Nasdaq 09:30/09:35/09:40 America/New_York.
- Previous-day range bug fixed: PDH/PDL now derives from M5 session bars rather than UTC-dated daily bars.
- Independent EMA validation now reads Saxo M5 and H1 candles directly and matches the production dashboard.
- DAX validation: M5 EMA8 25360.521688 / EMA21 25359.227640; H1 EMA8 25396.098324 / EMA21 25481.353126.
- Nasdaq validation: M5 EMA8 30475.181274 / EMA21 30468.482252; H1 EMA8 30505.935626 / EMA21 30571.474159.
- Core market-data calculations verified: ORB, PDH/PDL, M5 EMA8/21, H1 EMA8/21.

## Integration update — 2026-09-24
- Added production read-only endpoint: /api/bridge/snapshot.
- Vercel deployment for the endpoint succeeded (commit ef7121fc3eff10c62fce2a10839cae198da6a8a9).
- Endpoint is no-store/noindex and returns derived DAX/Nasdaq market snapshots only; it does not expose account data, orders, OAuth tokens or Saxo credentials.
- Next integration step: secure the bridge with BRIDGE_API_KEY and connect it as an external API action/plugin so future ChatGPT analysis can request fresh Saxo data without screenshots.


## Final integration state — 2026-09-24

- Secure read-only chain is operational: Saxo LIVE OpenAPI -> Vercel -> GitHub Actions -> ChatGPT GitHub connector.
- Production bridge endpoint: `/api/bridge/snapshot`.
- Endpoint requires `x-api-key` matching Vercel `BRIDGE_API_KEY`; GitHub Actions stores the same value as a repository secret. Secrets are not committed.
- GitHub workflow `.github/workflows/refresh-market-snapshot.yml` can be triggered by a change to `MARKET_REFRESH_TRIGGER.txt`; it fetches the protected bridge and writes `data/live-market-snapshot.json`.
- Verified end-to-end workflow run succeeded after Saxo reconnect and API-key rotation.
- Asian Range is now fixed to **02:00–08:00 Europe/Copenhagen** for both DAX and Nasdaq and was verified in the live snapshot.
- DAX ORB remains **09:00–09:15 Europe/Copenhagen**.
- Nasdaq ORB remains **09:30–09:45 America/New_York** (DST-safe internally).
- Snapshot contains: current/last M5 close, ORB H/L, Asian H/L, PDH/PDL, M5 EMA8/21, H1 EMA8/21, nearest support/resistance.
- Technical context additionally contains: H1/M5 direction, ORB/Asian/previous-day state, alignment score, LONG/SHORT/WAIT technical candidate, last-3-M5 ORB acceptance, displacement metrics, and data freshness.
- Final trading decision is intentionally not based on technical score alone. ChatGPT must combine the fresh snapshot with current macro/news/catalyst context and return LONG / SHORT / WAIT, confidence, entry condition, invalidation/stop, TP1/TP2, and concise reasoning.
- If snapshot freshness is stale, do not invent a live signal. Refresh first; if Saxo is disconnected, reconnect OAuth.
- No order placement, account data, Saxo credentials, OAuth tokens, or secrets are exposed by the bridge.
- Old screenshot-based trading automations remain disabled.
- Operational security follow-up: repository is currently public, so the derived `data/live-market-snapshot.json` file is publicly readable. No secrets/account data are in it, but making the repository private is recommended if the GitHub/Vercel connections are retained.
