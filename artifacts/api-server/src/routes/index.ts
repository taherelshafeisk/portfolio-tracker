import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import positionsRouter from "./positions";
import activitiesRouter from "./activities";
import marketRouter from "./market";
import portfolioRouter from "./portfolio";
import anthropicRouter from "./anthropic/index";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/accounts", accountsRouter);
router.use("/positions", positionsRouter);
router.use("/activities", activitiesRouter);
router.use("/market", marketRouter);
router.use("/portfolio", portfolioRouter);
router.use("/anthropic", anthropicRouter);

export default router;
