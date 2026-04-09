import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import devvitRouter from "./devvit";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(devvitRouter);
router.use(requireAuth);
router.use(proxyRouter);

export default router;
