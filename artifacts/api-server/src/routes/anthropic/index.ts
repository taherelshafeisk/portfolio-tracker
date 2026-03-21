import { Router, type IRouter } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

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
    const { imageBase64, mediaType, parseType = "activities" } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image provided" });

    const today = new Date().toISOString().split("T")[0];

    const activitiesPrompt = `Analyze this brokerage or trading app screenshot carefully.

First, identify the brokerage or account name visible in the screenshot (e.g. "Interactive Brokers", "Robinhood", "WIO Bank", etc.). This is the accountHint.

Then extract ALL trade/transaction records shown. For each trade return:
- activityType: one of "buy", "sell", "dividend", "deposit", "withdrawal" (required)
- symbol: stock ticker exactly as shown (e.g. "AAPL", "MSFT") — null if not a stock trade
- quantity: number of shares/units as a number — null if not shown
- price: price per share/unit as a number — null if not shown
- totalAmount: total transaction value as a number — null if not shown
- tradeDate: the exact date shown in YYYY-MM-DD format. Today is ${today}. Look carefully for dates — they may be written as "Mar 19, 2026" or "19/03/2026" etc. Convert all to YYYY-MM-DD. If no date visible use ${today}.
- notes: 1-line description of this row

Return a JSON object (not array) with exactly these two keys:
{"accountHint": "broker name or null", "trades": [...array of trade objects...]}

Return ONLY valid JSON, no markdown, no code fences, no explanation.
Example: {"accountHint":"Interactive Brokers","trades":[{"activityType":"buy","symbol":"AAPL","quantity":10,"price":185.50,"totalAmount":1855.00,"tradeDate":"2026-03-19","notes":"Market buy"}]}
If no trades found: {"accountHint":null,"trades":[]}`;

    const positionsPrompt = `Analyze this brokerage portfolio or holdings screenshot carefully.

First, identify the brokerage or account name visible (e.g. "Interactive Brokers", "WIO Bank"). This is the accountHint.

Then extract ALL positions/holdings shown. For each position return:
- symbol: stock ticker exactly as shown (e.g. "AAPL") — required
- name: company or ETF full name as shown — required
- quantity: number of shares/units as a number — required
- avgCost: average cost / average price paid per share as a number — use cost basis, avg price, or book value
- currentPrice: current market price per share if shown — null if not shown
- sector: sector or asset class if shown — null if not shown
- notes: any additional info visible

Return a JSON object with exactly two keys:
{"accountHint": "broker name or null", "positions": [...array of position objects...]}

Return ONLY valid JSON, no markdown, no code fences, no explanation.
Example: {"accountHint":"WIO Bank","positions":[{"symbol":"NVDA","name":"NVIDIA Corporation","quantity":5,"avgCost":450.00,"currentPrice":875.00,"sector":"Technology","notes":""}]}
If no positions found: {"accountHint":null,"positions":[]}`;

    const prompt = parseType === "positions" ? positionsPrompt : activitiesPrompt;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: (mediaType || "image/jpeg") as any,
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    // Extract JSON object from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.json(parseType === "positions" ? { accountHint: null, positions: [] } : { accountHint: null, trades: [] });
    }
    const parsed = JSON.parse(match[0]);
    res.json(parsed);
  } catch (error) {
    console.error("Parse screenshot error:", error);
    res.status(500).json({ error: "Failed to parse screenshot" });
  }
});

export default router;
