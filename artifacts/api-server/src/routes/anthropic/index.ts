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

export default router;
