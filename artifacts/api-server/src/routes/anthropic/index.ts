import { Router, type IRouter } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

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

    let fullResponse = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: `You are an expert financial advisor and portfolio manager AI assistant. 
You help users analyze their portfolio, make trading decisions, screen stocks for swing trades, 
and understand market movements. You have deep knowledge of:
- Long-term investing strategies (buy and hold, dividend investing)
- Swing trading techniques (technical analysis, RSI, MACD, support/resistance)
- Day trading strategies (momentum, scalping, risk management)
- Risk management and position sizing
- Market indices and macroeconomic analysis

Provide concise, actionable advice. Use specific numbers and percentages when possible.
Be direct but acknowledge risks. Format responses clearly with bullet points when listing multiple items.`,
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
  } catch (error) {
    console.error("Streaming error:", error);
    res.write(`data: ${JSON.stringify({ error: "Failed to process message" })}\n\n`);
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

IMPORTANT - avgCost derivation rules (apply in order):
1. If avgCost or average cost per share is shown directly, use it.
2. If not shown directly, derive from totalCurrentValue + gainOrLossAmount + quantity:
   - GAIN position (↑ arrow, green, + sign): costBasis = totalCurrentValue - gainAmount. avgCost = costBasis / quantity.
   - LOSS position (↓ arrow, red, - sign): costBasis = totalCurrentValue + lossAmount (add because you paid MORE than current value). avgCost = costBasis / quantity.
   - Using percent: avgCost = (totalCurrentValue / (1 + gainPct/100)) / quantity  where gainPct is negative for losses.
3. If none of the above work, set avgCost to null. Never set avgCost = totalCurrentValue / quantity without accounting for gain/loss.

Examples:
- GAIN: "17.41 GOOGL, $5,066.47 total, ↑$848.37 (20.11%)" → costBasis = 5066.47 - 848.37 = 4218.10 → avgCost = 4218.10 / 17.41 = 242.28
- LOSS: "0.03387 BTC, ฿10,354.11 total, ↓฿3,926.98 (27.5%)" → costBasis = 10354.11 + 3926.98 = 14281.09 → avgCost = 14281.09 / 0.03387 = 421672 (in portfolio currency, will be converted to USD)

If there is a cash, USD, or money market row, extract its value as cashBalance and do NOT include it in the positions array. Only return the JSON object, no additional text. If no positions are visible, return an empty positions array.`
      : `Analyze this screenshot of a brokerage account transaction/trade history page. Extract all recent trades and return them as a JSON object with this exact structure:
{
  "accountHint": "extract the account name or broker from the screenshot",
  "trades": [
    {
      "activityType": "buy" or "sell" or "dividend" or "deposit" or "withdrawal",
      "symbol": "stock ticker symbol (null for cash transactions)",
      "quantity": number of shares (null for cash transactions),
      "price": price per share as a number (null for cash transactions),
      "totalAmount": total transaction amount as a number,
      "tradeDate": "date in YYYY-MM-DD format",
      "notes": "any additional transaction notes"
    }
  ]
}
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

      // Convert non-USD amounts to USD
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
