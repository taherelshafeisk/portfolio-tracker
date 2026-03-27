# Order Suggestion Engine

Purpose:
Provide suggested manual orders for execution on external broker platforms.

Initial scope:
- manual suggestions only
- no auto-execution
- IBKR connection is future scope
- Wio and Expat remain manual

Each suggested order should include:
- sleeve
- symbol
- side
- quantity
- order type
- price logic
- time in force
- urgency
- rationale
- source rule or trigger
- execution notes

Order types for v1:
- Market
- Limit
- Stop
- Stop Limit
- Laddered Limit

Decision factors:
- urgency of risk reduction
- volatility
- spread/liquidity
- trim vs exit vs add
- leverage pressure
- concentration
- rule violations
