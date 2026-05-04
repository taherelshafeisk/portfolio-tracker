import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { validate } from "../middlewares/validate";
import { CreateAccountBody, UpdateAccountBody } from "@workspace/api-zod/schemas";
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  listAccountPositions,
  toAccountResponse,
} from "../services/accountService";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const accounts = await listAccounts(req.userId);
    res.json(accounts);
  } catch (error) {
    logger.error(error, "[accounts GET /] Error");
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

router.post("/", validate(CreateAccountBody), async (req, res) => {
  try {
    const { name, broker, accountType, currency, initialBalance } = req.body;
    const account = await createAccount({ name, broker, accountType, currency, initialBalance, userId: req.userId });
    res.status(201).json(account);
  } catch (error) {
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const account = await getAccount(id, req.userId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    return res.json(toAccountResponse(account));
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch account" });
  }
});

router.put("/:id", validate(UpdateAccountBody), async (req, res) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
    const { name, broker, accountType, currentBalance, sleeveKey, maxLeverageRatio, ipsVersion, concentrationLimit, leverageCeiling } = req.body;
    const account = await updateAccount(id, req.userId, {
      name, broker, accountType, currentBalance, sleeveKey, maxLeverageRatio, ipsVersion, concentrationLimit, leverageCeiling,
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    return res.json(account);
  } catch (error) {
    return res.status(500).json({ error: "Failed to update account" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const found = await deleteAccount(id, req.userId);
    if (!found) return res.status(404).json({ error: "Account not found" });
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete account" });
  }
});

router.get("/:id/positions", async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const positions = await listAccountPositions(accountId, req.userId);
    if (positions === null) return res.status(404).json({ error: "Account not found" });
    return res.json(positions);
  } catch (error) {
    logger.error(error, "[accounts GET /:id/positions] Error");
    return res.status(500).json({ error: "Failed to fetch positions" });
  }
});

export default router;
