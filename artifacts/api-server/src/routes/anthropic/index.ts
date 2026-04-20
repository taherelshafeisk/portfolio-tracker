import { Router, type IRouter } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { accountsTable, positionsTable, alertsTable, portfolioPolicyTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { fetchLivePrices } from "../positions";
import { resolveTickerFromName, derivePriceFromAmount, inferTradeCurrency } from "./trade-utils";

const router: IRouter = Router();

const DEFAULT_CONC_LIMIT = 0.20;
const DEFAULT_LEV_CEILING = 1.50;

async function buildPortfolioContext(): Promise<string> {
  try {
    const [accounts, allPositions, activeAlerts, policyRows] = await Promise.all([
      db.select().from(accountsTable),
      db.select().from(positionsTable),
      db.select().from(alertsTable).where(inArray(alertsTable.status, ["active", "acknowledged"])),
      db.select().from(portfolioPolicyTable).limit(1),
    ]);

    if (accounts.length === 0) return "The user has not added any accounts or positions yet.";

    const symbols = [...new Set(allPositions.map(p => p.symbol))];
    const priceMap = symbols.length > 0 ? await fetchLivePrices(symbols) : {};
    const policy = policyRows[0] ?? null;

    let totalNav = 0;
    let totalCost = 0;
    let totalUnrealizedPnl = 0;

    const accountLines: string[] = [];
    const cutListLines: string[] = [];

    for (const account of accounts) {
      const positions = allPositions.filter(p => p.accountId === account.id);
      const concLimit = account.concentrationLimit != null ? parseFloat(account.concentrationLimit) : DEFAULT_CONC_LIMIT;
      const levCeiling = account.leverageCeiling != null ? parseFloat(account.leverageCeiling) : DEFAULT_LEV_CEILING;
      const cash = parseFloat(account.currentBalance);

      let accMV = 0;
      let accCost = 0;
      let accPnl = 0;

      const posData = positions.map(p => {
        const qty = parseFloat(p.quantity);
        const avg = parseFloat(p.avgCost);
        const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
        const mv = qty * cur;
        const cost = qty * avg;
        const pnl = mv - cost;
        accMV += mv;
        accCost += cost;
        accPnl += pnl;
        return { p, qty, avg, cur, mv, cost, pnl };
      });

      const accNav = accMV + cash;
      // Leverage ratio = total positions MV / equity (equity = MV + cash; if cash < 0, equity < MV)
      const equity = accMV + cash;
      const leverageRatio = equity > 0 ? accMV / equity : 0;
      const levViolation = leverageRatio > levCeiling;

      totalNav += accNav;
      totalCost += accCost + cash;
      totalUnrealizedPnl += accPnl;

      const posLines: string[] = [];
      for (const { p, qty, avg, cur, mv, cost, pnl } of posData) {
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        const concPct = accNav > 0 ? (mv / accNav) * 100 : 0;
        const bucket = p.positionBucket ?? "unassigned";
        const action = p.ipsAction ?? "none";
        const concBreach = concPct / 100 > concLimit ? ` [CONC BREACH: ${concPct.toFixed(1)}% > ${(concLimit * 100).toFixed(0)}% limit]` : "";

        let line = `    - ${p.symbol} (${p.name}): ${qty} units @ avg $${avg.toFixed(2)}, cur $${cur.toFixed(2)}, MV $${mv.toFixed(2)} (${concPct.toFixed(1)}% of NAV), P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%), bucket: ${bucket}, IPS action: ${action}${concBreach}`;
        if (p.stopPrice) line += `, stop: $${parseFloat(p.stopPrice).toFixed(2)}`;
        if (p.addZoneLow && p.addZoneHigh) line += `, add zone: $${parseFloat(p.addZoneLow).toFixed(2)}–$${parseFloat(p.addZoneHigh).toFixed(2)}`;
        if (p.sector) line += `, sector: ${p.sector}`;
        posLines.push(line);

        if (p.ipsAction === "cut" || p.positionBucket === "cut") {
          cutListLines.push(`  - ${p.symbol} in "${account.name}": MV $${mv.toFixed(2)}, P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%), on cut list since ${p.cutListAddedAt ? p.cutListAddedAt.toISOString().slice(0, 10) : "unknown"}`);
        }
      }

      const accPnlPct = accCost > 0 ? (accPnl / accCost) * 100 : 0;
      accountLines.push([
        `  Account: "${account.name}" (${account.accountType}, broker: ${account.broker})`,
        `  NAV: $${accNav.toFixed(2)}, Cash: $${cash.toFixed(2)}, Unrealized P&L: ${accPnl >= 0 ? "+" : ""}$${accPnl.toFixed(2)} (${accPnlPct >= 0 ? "+" : ""}${accPnlPct.toFixed(1)}%)`,
        `  IPS rules: concentration limit ${(concLimit * 100).toFixed(0)}%, leverage ceiling ${levCeiling.toFixed(2)}x, current leverage ${leverageRatio.toFixed(2)}x${levViolation ? " [LEVERAGE BREACH]" : ""}`,
        `  Positions:\n${posLines.join("\n") || "    (none)"}`,
      ].join("\n"));
    }

    const totalPnlPct = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0;

    const alertLines = activeAlerts.length > 0
      ? activeAlerts.map(a => `  - [${a.severity.toUpperCase()}] ${a.title}: ${a.message} (${a.status})`).join("\n")
      : "  None";

    let policySection = "  No global policy set.";
    if (policy) {
      const pl: string[] = [];
      if (policy.goldFloorPct != null) pl.push(`Gold floor: ${parseFloat(policy.goldFloorPct).toFixed(1)}% of NAV`);
      if (policy.goldTargetPct != null) pl.push(`Gold target: ${parseFloat(policy.goldTargetPct).toFixed(1)}% by ${policy.goldTargetDate ?? "?"}`);
      if (policy.macroPosture) pl.push(`Macro posture: ${policy.macroPosture}`);
      if (policy.ipsVersion) pl.push(`IPS version: ${policy.ipsVersion}`);
      if (policy.monthlyContribution != null) pl.push(`Monthly contribution: $${parseFloat(policy.monthlyContribution).toFixed(0)}`);
      policySection = pl.length > 0 ? pl.map(l => `  ${l}`).join("\n") : "  No details set.";
    }

    return `CURRENT PORTFOLIO (live):
Total NAV: $${totalNav.toFixed(2)}
Total Unrealized P&L: ${totalUnrealizedPnl >= 0 ? "+" : ""}$${totalUnrealizedPnl.toFixed(2)} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)
Accounts: ${accounts.length}

${accountLines.join("\n\n")}

CUT LIST:
${cutListLines.length > 0 ? cutListLines.join("\n") : "  None"}

ACTIVE ALERTS:
${alertLines}

GLOBAL POLICY:
${policySection}`;
  } catch (e) {
    console.error("[buildPortfolioContext] Error:", e);
    return "Portfolio data temporarily unavailable.";
  }
}

async function fetchForexRateToUSD(fromCurrency: string): Promise<number> {
  try {
    // Fetch USD/{currency} — always available on Yahoo (e.g. USDAED=X ≈ 3.6725)
    // Then invert to get how many USD per 1 unit of fromCurrency
    const ticker = `USD${fromCurrency.toUpperCase()}=X`;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return 1;
    const json = await res.json();
    const usdPerForeignInverse = json?.chart?.result?.[0]?.meta?.regularMarketPrice; // e.g. 3.6725 for AED
    if (typeof usdPerForeignInverse !== "number" || usdPerForeignInverse <= 0) return 1;
    const rate = 1 / usdPerForeignInverse; // e.g. 0.272 USD per 1 AED
    console.log(`[forex] USD${fromCurrency.toUpperCase()}=X = ${usdPerForeignInverse} → 1 ${fromCurrency} = ${rate.toFixed(6)} USD`);
    return rate;
  } catch {
    return 1;
  }
}

const toConversation = (c: typeof conversationsTable.$inferSelect) => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt.toISOString(),
});

const toMessage = (m: typeof messagesTable.$inferSelect) => ({
  id: m.id,
  conversationId: m.conversationId,
  role: m.role,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
});

router.get("/conversations", async (_req, res) => {
  try {
    const conversations = await db.select().from(conversationsTable).orderBy(conversationsTable.createdAt);
    res.json(conversations.map(toConversation));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const { title } = req.body;
    const [conversation] = await db.insert(conversationsTable).values({ title }).returning();
    res.status(201).json(toConversation(conversation));
  } catch (error) {
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conversation] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));
    res.json({ ...toConversation(conversation), messages: messages.map(toMessage) });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(asc(messagesTable.createdAt));
    res.json(messages.map(toMessage));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const { content } = req.body;

    // Save user message
    await db.insert(messagesTable).values({ conversationId, role: "user", content });

    // Get conversation history
    const history = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(asc(messagesTable.createdAt));

    const chatMessages = history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const portfolioContext = await buildPortfolioContext();

    let fullResponse = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `You are an IPS-aware portfolio advisor. You help the user manage their portfolio according to their Investment Policy Statement (IPS) rules and risk limits.

Your responsibilities:
- Identify IPS violations (concentration breaches, leverage ceiling breaches, cut-list positions not yet exited)
- Evaluate each position's risk/reward against its IPS action (hold/add/trim/cut/exit) and bucket (core/swing/spec/def/anchor/inc/cut)
- Flag active alerts and explain what action to take
- Give concise, specific, numbers-first answers — no fluff
- Do not ask for data you already have below

---
${portfolioContext}
---

Rules:
- Concentration limit: a position breaching its account's limit is a violation requiring trim or cut
- Leverage ceiling: account leverage above ceiling is a violation requiring immediate cash injection or position reduction
- Cut list: any position with IPS action "cut" or bucket "cut" must be exited — ask about progress if user hasn't mentioned it
- Gold floor: if a gold floor % is set in global policy, flag if the portfolio's gold allocation is below it`,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    // Save assistant message
    await db.insert(messagesTable).values({
      conversationId,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("[AI chat] Streaming error:", error?.status, error?.message, error?.error ?? error);
    const msg = error?.error?.message || error?.message || "Failed to process message";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

router.post("/parse-screenshot", async (req, res) => {
  try {
    const { imageBase64, mediaType, parseType = "positions" } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image provided" });

    const mimeType = (mediaType || "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";

    const prompt = parseType === "positions"
      ? `Analyze this screenshot of a brokerage account positions/portfolio page. Extract all stock/ETF/crypto/commodity positions and return them as a JSON object with this exact structure:
{
  "accountHint": "extract the account name or broker from the screenshot",
  "currency": "ISO 4217 currency code of the amounts shown. Detection rules (in order): $ = USD, £ = GBP, € = EUR, ¥ = JPY, ₹ = INR, ₩ = KRW, Fr = CHF, A$ = AUD, C$ = CAD. For UAE/Gulf brokers (WIO, Emirates NBD, ADIB, FAB, Mashreq, Liv, etc.) always return AED — WIO Bank specifically uses ฿ as their AED currency display symbol (not Thai Baht), so if you see ฿ alongside a UAE broker name like WIO, return AED. If the accountHint suggests a UAE or Gulf-based institution, default to AED rather than USD.",
  "cashBalance": cash or money-market balance as a number in the screenshot's currency (null if not present),
  "positions": [
    {
      "symbol": "stock ticker symbol",
      "name": "company name",
      "quantity": number of shares/units as a number,
      "avgCost": average cost per share as a number (see derivation rules below),
      "currentPrice": current price per share as a number (if available),
      "sector": "industry sector if visible",
      "notes": "any additional notes from the screenshot"
    }
  ]
}

IMPORTANT - avgCost extraction rules (apply in order, stop at first match):
1. DIRECT EXTRACTION (always preferred over derivation): If a column header or row label shows the average purchase price, read the number directly from that cell. Do NOT calculate — just copy the number.
   Column headers that mean average cost (treat all as equivalent):
     "Avg Price"  ← IBKR uses this exact label
     "Avg Cost", "Avg. Cost", "Average Cost", "Average Price"
     "Cost Basis/Share", "Cost/Share", "Purchase Price", "Book Value/Share"
     "Break Even", "Open Price", "Entry Price"

   IBKR example — the table has these columns left to right:
     Instrument | Intraday | Last | Change | Chg% | Position | P&L | Avg Price | Unrlzd P&L | %NetLiq | Unrlzd P&L%
   For row: MSFT ... 379.32 ... 42 ... 295.26 ... 465.24 ... -3609 ...
     → avgCost = 465.24   (read directly from the "Avg Price" column; ignore P&L 295.26, Unrlzd P&L -3609, %NetLiq, Chg%)

2. DERIVATION (only when the "Avg Price" / cost column is absent): Compute from total position value and unrealised P&L.

   Formula (use whichever values are visible):
   - GAIN (green, ↑, +): costBasis = totalPositionValue − |unrealisedGain|;  avgCost = costBasis / quantity
   - LOSS (red, ↓, −):  costBasis = totalPositionValue + |unrealisedLoss|;   avgCost = costBasis / quantity
   "totalPositionValue" is the current market value of the whole position (qty × currentPrice). Use it directly.

   Using % only (when gain/loss amount is not shown as a number):
     currentPrice = totalPositionValue / quantity
     avgCost = currentPrice / (1 + unrealisedPct/100)   ← unrealisedPct is NEGATIVE for losses

   Labels that mean unrealised P&L (use for derivation):
   - "Unrlzd P&L", "Unrealized P&L", "Open P&L", "Floating P&L", "G/L", "Gain/Loss"
   - WIO app: the ↑ or ↓ coloured amount shown below the total position value on a card
   IGNORE for derivation: "P&L" alone (= realised), "Chg %", "Change %", "Day Change", "%NetLiq".

   WIO Securities app card format — positions appear as individual cards, not a table:
     Left side:  "[icon] / Full Instrument Name / qty TICKER"
     Right side: "฿totalValue / ↑฿gain (pct%)"  or  "฿totalValue / ↓฿loss (pct%)"
     (฿ is WIO Bank's AED display symbol, not Thai Baht)

   WIO DERIVATION EXAMPLE — loss card:
     Left:  iShares Gold Trust / 0.73843 IAU
     Right: ฿13,000 / ↓฿444 (3.31%)
     → qty=0.73843, totalValue=13000 AED, unrealisedLoss=444 AED (↓ = loss)
     → costBasis = 13000 + 444 = 13444 AED
     → avgCost = 13444 / 0.73843 ≈ 18207.5 AED   ✓

   WIO DERIVATION EXAMPLE — gain card:
     Left:  Apple Inc / 5 AAPL
     Right: ฿9,200 / ↑฿300 (3.37%)
     → qty=5, totalValue=9200, unrealisedGain=300 (↑ = gain)
     → costBasis = 9200 − 300 = 8900
     → avgCost = 8900 / 5 = 1780   ✓

   CRITICAL: NEVER set avgCost = totalValue / quantity. That equals the current price, not the avg cost.
   The only correct formula is: costBasis = totalValue ± unrealisedPnl, then avgCost = costBasis / qty.

3. If neither rule works — i.e. you cannot find either (a) an avg cost column or (b) both a total value AND an unrealised P&L amount or percentage — set avgCost to null. Do not guess.

CASH ROWS — critical exclusion rules:
- Any row under a "Cash Balances", "Cash & Equivalents", or "Liquidity" section header must be excluded from the positions array entirely — even if it has a dollar amount. Extract its value as cashBalance instead.
- Rows labelled "USD Cash", "Total Cash", "Cash", "Money Market", "USD", or similar cash identifiers are NEVER positions.
- cashBalance may be negative (e.g. -15,300 = margin loan). Extract the signed value as-is.
- If multiple cash rows are visible (e.g. "USD Cash" and "Total Cash"), use "Total Cash" as cashBalance.

Only return the JSON object, no additional text. If no positions are visible, return an empty positions array.`
      : `Analyze this screenshot of a brokerage account transaction/trade history page. Extract all recent trades and return them as a JSON object with this exact structure:
{
  "accountHint": "extract the account name or broker from the screenshot",
  "currency": "ISO 4217 currency code for amounts in this screenshot (USD, AED, GBP, etc.). For WIO Bank or other UAE/Gulf brokers, return AED even if the ฿ symbol is used.",
  "trades": [
    {
      "activityType": "buy" or "sell" or "dividend" or "deposit" or "withdrawal",
      "symbol": "ticker symbol — see resolution rules below",
      "name": "full instrument name as displayed (e.g. 'State Street Energy Select Sector SPDR')",
      "quantity": number of units as a number (null for pure cash transactions). Include fractional and crypto quantities exactly as shown (e.g. 0.00567 for BTC).
      "sourceCurrency": "ISO 4217 currency code for THIS specific trade's price and totalAmount. On WIO/UAE accounts with mixed currencies: use 'AED' for crypto trades (BTC, ETH, SOL, etc.) and 'USD' for stock/ETF trades priced in dollars. Match exactly what's shown in the row — do not guess.",
      "price": price per unit in the row's native currency as a number — see derivation rules below,
      "totalAmount": total transaction cash amount as a number with sign (negative = cash out / buy, positive = cash in / sell or dividend). If a formatted number like '1,489.59' or '-482.61' is visible in the row, use it here. Do NOT convert to another currency.
      "tradeDate": "date in YYYY-MM-DD format",
      "notes": "any additional transaction notes"
    }
  ]
}

TICKER SYMBOL RESOLUTION RULES (apply in order):
1. If the instrument has a well-known name, resolve to the canonical ticker:
   - "State Street Energy Select" / "Energy Select Sector SPDR" → XLE
   - "SPDR S&P 500 ETF" / "State Street S&P 500" → SPY
   - "Invesco QQQ" → QQQ
   - "iShares Core S&P 500" → IVV
   - "iShares Russell 2000" → IWM
   Use the name field to identify these even when the OCR-extracted ticker looks different.
2. If the ticker is clearly printed and readable (1–5 uppercase letters, e.g. AAPL, XLE, BTC), use it.
3. If the ticker looks garbled, has unusual characters, or you are not confident, set symbol to null — do NOT guess. The user will fill it in manually.

PRICE DERIVATION RULES (apply in order):
1. If price per unit is directly visible in the row, extract it.
2. If price is NOT directly shown but BOTH quantity AND totalAmount are present:
   price = |totalAmount| / |quantity|   (use absolute values)
   This works for all types: stocks (8 shares), crypto (0.00567 BTC), fractional shares, etc.
   Example: sell 0.00567 BTC for +1,489.59 AED → price = 1489.59 / 0.00567 ≈ 262,716 AED
   Example: buy 8 shares for -482.61 USD → price = 482.61 / 8 = 60.33 USD
3. If quantity OR totalAmount is missing, set price to null — do NOT guess.

AMOUNT EXTRACTION FALLBACK:
If totalAmount is not shown as a structured field, look for a monetary number in the visible text of that row (e.g. '1,489.59', '+1489.59', '(482.61)'). Remove commas and parentheses (parentheses mean negative). Use that as totalAmount.

CURRENCY: Keep all prices and amounts in the native currency shown in the screenshot. Do NOT convert currencies during extraction. Return the detected currency code in the top-level "currency" field.

ORDER STATUS — CRITICAL EXCLUSION RULES:
Only include trades that were actually executed (filled). EXCLUDE any row where:
- The status contains "Cancelled", "Canceled", "Rejected", "Expired", "Pending", or "Not Filled"
- The filled quantity is 0 (e.g. "0 Filled", "Qty Filled: 0", "Filled: 0/8")
- The row describes an open/working order that has not yet executed
Example rows to SKIP entirely: "Stop 263.00, Day order. Cancelled, 0 Filled", "Limit 50.00 - Pending", "GTC order - Rejected"
If in doubt, omit the row — the user can add it manually.

Only return the JSON object, no additional text. If no trades are visible, return an empty trades array.`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    if (!content) {
      return res.status(500).json({ error: "Failed to parse image" });
    }

    // Strip markdown code fences if present
    const jsonText = content.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();

    try {
      const parsedData = JSON.parse(jsonText);

      // Convert non-USD amounts to USD (positions only)
      if (parseType === "positions") {
        const currency: string = (parsedData.currency || "USD").toUpperCase();
        console.log(`[parse-screenshot] accountHint="${parsedData.accountHint}" detectedCurrency=${currency} positions=${parsedData.positions?.length ?? 0}`);
        if (currency !== "USD") {
          const rate = await fetchForexRateToUSD(currency);
          console.log(`[forex] Converting ${currency} → USD at rate ${rate}`);
          for (const pos of parsedData.positions || []) {
            if (pos.avgCost != null) pos.avgCost = parseFloat((pos.avgCost * rate).toFixed(4));
            if (pos.currentPrice != null) pos.currentPrice = parseFloat((pos.currentPrice * rate).toFixed(4));
          }
          if (parsedData.cashBalance != null) {
            parsedData.cashBalance = parseFloat((parsedData.cashBalance * rate).toFixed(2));
          }
          parsedData.originalCurrency = currency;
          parsedData.fxRate = rate;
          parsedData.currency = "USD";
        }
        // Flag positions where avgCost could not be determined so the UI can warn the user
        for (const pos of parsedData.positions || []) {
          if (pos.avgCost == null) {
            pos._avgCostMissing = true;
          }
        }
      }

      // Post-process activities: ticker resolution, price derivation, currency conversion
      if (parseType === "activities") {
        const accountCurrency: string = (parsedData.currency || "USD").toUpperCase();
        console.log(`[parse-screenshot] accountHint="${parsedData.accountHint}" detectedCurrency=${accountCurrency} trades=${parsedData.trades?.length ?? 0}`);
        parsedData.currency = accountCurrency;

        // Determine the effective currency for each trade.
        // inferTradeCurrency uses a crypto-symbol heuristic so that BTC/ETH on
        // WIO (AED) accounts are always treated as AED even when Claude omits
        // sourceCurrency or when the top-level currency was wrongly detected as USD.
        const tradeCurrencies: string[] = (parsedData.trades || []).map((trade: any) =>
          inferTradeCurrency(trade.symbol, trade.sourceCurrency, accountCurrency)
        );

        // Collect unique non-USD currencies and fetch rates once each
        const currenciesToConvert = new Set<string>(tradeCurrencies.filter(c => c !== "USD"));
        const fxRates: Record<string, number> = {};
        for (const currency of currenciesToConvert) {
          fxRates[currency] = await fetchForexRateToUSD(currency);
          console.log(`[forex] ${currency} → USD rate: ${fxRates[currency]}`);
        }

        // Drop cancelled/unfilled orders: buy and sell must have qty > 0
        parsedData.trades = (parsedData.trades || []).filter((trade: any) => {
          if (trade.activityType === "buy" || trade.activityType === "sell") {
            return trade.quantity != null && trade.quantity > 0;
          }
          return true;
        });

        for (let i = 0; i < (parsedData.trades || []).length; i++) {
          const trade = parsedData.trades[i];
          const tradeCurrency = tradeCurrencies[i];

          // Ticker resolution: prefer name field → notes text → OCR ticker
          // Claude sometimes puts the full instrument name in notes instead of name field
          const resolved = resolveTickerFromName(trade.name, trade.symbol, trade.notes);
          trade.symbol = resolved.symbol;
          trade._symbolConfident = resolved.confident;

          // Price derivation: derive BEFORE currency conversion so it uses native amounts
          if (trade.price == null && trade.quantity != null && trade.totalAmount != null) {
            const derived = derivePriceFromAmount(trade.quantity, trade.totalAmount);
            if (derived != null) {
              trade.price = parseFloat(derived.toFixed(6));
              trade._priceWasDerived = true;
            }
          }

          // Per-trade currency conversion → USD
          trade.sourceCurrency = tradeCurrency;
          if (tradeCurrency !== "USD" && fxRates[tradeCurrency]) {
            const rate = fxRates[tradeCurrency];
            if (trade.price != null) trade.price = parseFloat((trade.price * rate).toFixed(6));
            if (trade.totalAmount != null) trade.totalAmount = parseFloat((trade.totalAmount * rate).toFixed(2));
            trade._originalCurrency = tradeCurrency;
          }
        }
      }

      res.json(parsedData);
    } catch (parseError) {
      console.error("Failed to parse Claude response as JSON:", content);
      res.status(500).json({ error: "Failed to parse response from AI" });
    }
  } catch (error: any) {
    console.error("Parse screenshot error:", error);
    const status = Number(error?.status) || 500;
    const message = error?.error?.message || error?.message || "Failed to parse screenshot";
    return res.status(status).json({ error: message });
  }
});

export default router;
