import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/summary", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable);
    const allPositions = await db.select().from(positionsTable);

    let totalNav = 0;
    let totalCost = 0;

    const accountSummaries = await Promise.all(accounts.map(async (account) => {
      const positions = allPositions.filter(p => p.accountId === account.id);
      let accountNav = parseFloat(account.currentBalance);
      let accountCost = 0;
      let accountUnrealizedPnl = 0;

      positions.forEach(p => {
        const qty = parseFloat(p.quantity);
        const avg = parseFloat(p.avgCost);
        const cur = parseFloat(p.currentPrice);
        const marketValue = qty * cur;
        const cost = qty * avg;
        accountNav += marketValue;
        accountCost += cost;
        accountUnrealizedPnl += marketValue - cost;
      });

      totalNav += accountNav;
      totalCost += accountCost + parseFloat(account.currentBalance);

      const unrealizedPnlPct = accountCost > 0 ? (accountUnrealizedPnl / accountCost) * 100 : 0;

      return {
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        nav: accountNav,
        unrealizedPnl: accountUnrealizedPnl,
        unrealizedPnlPct,
        positionCount: positions.length,
      };
    }));

    const totalUnrealizedPnl = totalNav - totalCost;
    const totalUnrealizedPnlPct = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0;

    res.json({
      totalNav,
      totalCost,
      totalUnrealizedPnl,
      totalUnrealizedPnlPct,
      dayChange: 0,
      dayChangePct: 0,
      accountCount: accounts.length,
      positionCount: allPositions.length,
      accounts: accountSummaries,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch portfolio summary" });
  }
});

export default router;
