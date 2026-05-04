import { db, macroPostureTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export function rowToResponse(row: typeof macroPostureTable.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    notes: row.notes,
    cryptoView: row.cryptoView,
    recessionRisk: row.recessionRisk ?? null,
    isActive: row.isActive,
    setAt: row.setAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getActiveMacroPosture(userId: string) {
  const [row] = await db
    .select()
    .from(macroPostureTable)
    .where(and(eq(macroPostureTable.isActive, true), eq(macroPostureTable.userId, userId)))
    .limit(1);
  return row ? rowToResponse(row) : null;
}

export interface SetMacroPostureInput {
  label: string;
  notes?: string | null;
  cryptoView?: string | null;
  recessionRisk?: number | null;
}

export async function setMacroPosture(userId: string, input: SetMacroPostureInput) {
  const now = new Date();
  const inserted = await db.transaction(async (tx) => {
    await tx
      .update(macroPostureTable)
      .set({ isActive: false, supersededAt: now })
      .where(and(eq(macroPostureTable.isActive, true), eq(macroPostureTable.userId, userId)));

    const [row] = await tx
      .insert(macroPostureTable)
      .values({
        label: input.label,
        notes: input.notes ?? null,
        cryptoView: input.cryptoView ?? null,
        recessionRisk: input.recessionRisk ?? null,
        isActive: true,
        setAt: now,
        userId,
      })
      .returning();

    return row;
  });
  return rowToResponse(inserted);
}
