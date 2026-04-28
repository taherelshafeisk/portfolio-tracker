import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, alertsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { validate } from "../middlewares/validate";
import { GenerateAlertsBody, z } from "@workspace/api-zod/schemas";
import { generateAlerts } from "../lib/alert-engine";

const PatchAlertBody = z.object({
  status: z.enum(["acknowledged", "resolved"]),
  dismissReason: z.string().nullable().optional(),
});

const router: IRouter = Router();

const GRACE_DEFAULT_MS   = 24 * 60 * 60 * 1000;
const GRACE_5_DAYS_MS    = 5  * 24 * 60 * 60 * 1000;

function gracePeriodMs(dismissReason: string | null): number {
  return dismissReason === 'Will act within 5 days' ? GRACE_5_DAYS_MS : GRACE_DEFAULT_MS;
}

function formatAlert(row: typeof alertsTable.$inferSelect) {
  return {
    id: row.id,
    accountId: row.accountId,
    positionId: row.positionId ?? null,
    symbol: row.symbol ?? null,
    alertType: row.alertType,
    severity: row.severity,
    title: row.title,
    message: row.message,
    metricValue: parseFloat(row.metricValue),
    thresholdValue: parseFloat(row.thresholdValue),
    fingerprint: row.fingerprint,
    status: row.status,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    dismissReason: row.dismissReason ?? null,
    generatedAt: row.generatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/generate", validate(GenerateAlertsBody), async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: number | null };

    const [allAccounts, allPositions] = await Promise.all([
      db.select().from(accountsTable).where(eq(accountsTable.userId, req.userId)),
      db.select().from(positionsTable).where(eq(positionsTable.userId, req.userId)),
    ]);

    const filteredAccounts = accountId
      ? allAccounts.filter((a) => a.id === accountId)
      : allAccounts;

    const engineAccounts = filteredAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      currentBalance: parseFloat(a.currentBalance),
    }));

    const enginePositions = allPositions
      .filter((p) => filteredAccounts.some((a) => a.id === p.accountId))
      .map((p) => ({
        id: p.id,
        accountId: p.accountId,
        symbol: p.symbol,
        quantity: parseFloat(p.quantity),
        avgCost: parseFloat(p.avgCost),
        currentPrice: parseFloat(p.currentPrice),
      }));

    const newAlerts = generateAlerts(engineAccounts, enginePositions);
    const now = new Date();

    const affectedAccountIds = filteredAccounts.map((a) => a.id);
    const existingAlerts = affectedAccountIds.length > 0
      ? await db.select().from(alertsTable)
          .where(and(
            inArray(alertsTable.accountId, affectedAccountIds),
            eq(alertsTable.userId, req.userId),
          ))
      : [];

    const newFingerprints = new Set(newAlerts.map((a) => a.fingerprint));
    const existingByFingerprint = new Map(existingAlerts.map((r) => [r.fingerprint, r]));

    const toResolve = existingAlerts.filter(
      (r) => r.status !== "resolved" && !newFingerprints.has(r.fingerprint),
    );
    if (toResolve.length > 0) {
      await db.update(alertsTable)
        .set({ status: "resolved", resolvedAt: now, updatedAt: now })
        .where(inArray(alertsTable.id, toResolve.map((r) => r.id)));
    }

    for (const alert of newAlerts) {
      const existing = existingByFingerprint.get(alert.fingerprint);

      if (!existing) {
        await db.insert(alertsTable).values({
          accountId: alert.accountId,
          positionId: alert.positionId ?? null,
          symbol: alert.symbol ?? null,
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metricValue: alert.metricValue.toString(),
          thresholdValue: alert.thresholdValue.toString(),
          fingerprint: alert.fingerprint,
          status: "active",
          generatedAt: now,
          userId: req.userId,
        });
        continue;
      }

      if (existing.status === "resolved") {
        await db.update(alertsTable)
          .set({
            severity: alert.severity, title: alert.title, message: alert.message,
            metricValue: alert.metricValue.toString(), thresholdValue: alert.thresholdValue.toString(),
            status: "active", resolvedAt: null, generatedAt: now, updatedAt: now,
          })
          .where(eq(alertsTable.id, existing.id));
        continue;
      }

      if (existing.status === "acknowledged") {
        const graceExpired =
          existing.acknowledgedAt &&
          now.getTime() - existing.acknowledgedAt.getTime() >= gracePeriodMs(existing.dismissReason ?? null);
        if (graceExpired) {
          await db.update(alertsTable)
            .set({
              severity: alert.severity, title: alert.title, message: alert.message,
              metricValue: alert.metricValue.toString(), thresholdValue: alert.thresholdValue.toString(),
              status: "active", acknowledgedAt: null, generatedAt: now, updatedAt: now,
            })
            .where(eq(alertsTable.id, existing.id));
        }
        continue;
      }

      await db.update(alertsTable)
        .set({
          severity: alert.severity, title: alert.title, message: alert.message,
          metricValue: alert.metricValue.toString(), thresholdValue: alert.thresholdValue.toString(),
          generatedAt: now, updatedAt: now,
        })
        .where(eq(alertsTable.id, existing.id));
    }

    const activeAlerts = affectedAccountIds.length > 0
      ? await db.select().from(alertsTable)
          .where(and(
            inArray(alertsTable.accountId, affectedAccountIds),
            eq(alertsTable.status, "active"),
            eq(alertsTable.userId, req.userId),
          ))
          .orderBy(alertsTable.generatedAt)
      : [];

    res.json(activeAlerts.map(formatAlert));
  } catch (error) {
    res.status(500).json({ error: "Failed to generate alerts" });
  }
});

router.get("/", async (req, res) => {
  try {
    const statusParam = req.query.status as string | undefined;
    const accountIdParam = req.query.accountId ? parseInt(req.query.accountId as string, 10) : undefined;
    const positionIdParam = req.query.positionId ? parseInt(req.query.positionId as string, 10) : undefined;

    const conditions = [eq(alertsTable.userId, req.userId)];
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) conditions.push(eq(alertsTable.status, statuses[0]));
      else if (statuses.length > 1) conditions.push(inArray(alertsTable.status, statuses));
    }
    if (accountIdParam) conditions.push(eq(alertsTable.accountId, accountIdParam));
    if (positionIdParam) conditions.push(eq(alertsTable.positionId, positionIdParam));

    const rows = await db.select().from(alertsTable)
      .where(and(...conditions))
      .orderBy(alertsTable.generatedAt);
    res.json(rows.map(formatAlert));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

router.patch("/:id", validate(PatchAlertBody), async (req, res) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
    const { status, dismissReason } = req.body as { status: "acknowledged" | "resolved"; dismissReason?: string | null };

    const now = new Date();
    const updateFields: Partial<typeof alertsTable.$inferInsert> = { status, updatedAt: now };
    if (status === "acknowledged") updateFields.acknowledgedAt = now;
    if (status === "resolved") updateFields.resolvedAt = now;
    if (dismissReason !== undefined) updateFields.dismissReason = dismissReason ?? null;

    const [updated] = await db.update(alertsTable).set(updateFields)
      .where(and(eq(alertsTable.id, id), eq(alertsTable.userId, req.userId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
    res.json(formatAlert(updated));
  } catch (error) {
    res.status(500).json({ error: "Failed to update alert" });
  }
});

export default router;
