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
