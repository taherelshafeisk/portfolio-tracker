import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import positionsRouter from "./positions";
import activitiesRouter from "./activities";
import marketRouter from "./market";
import portfolioRouter from "./portfolio";
import anthropicRouter from "./anthropic/index";
import orderSuggestionsRouter from "./orderSuggestions";
import alertsRouter from "./alerts";
import portfolioPolicyRouter from "./portfolioPolicy";
import ipsRouter from "./ips";
import convictionsRouter from "./convictions";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/accounts", accountsRouter);
router.use("/positions", positionsRouter);
router.use("/activities", activitiesRouter);
router.use("/market", marketRouter);
router.use("/portfolio", portfolioRouter);
router.use("/anthropic", anthropicRouter);
router.use("/order-suggestions", orderSuggestionsRouter);
router.use("/alerts", alertsRouter);
router.use("/portfolio-policy", portfolioPolicyRouter);
router.use("/ips", ipsRouter);
router.use("/convictions", convictionsRouter);

export default router;
