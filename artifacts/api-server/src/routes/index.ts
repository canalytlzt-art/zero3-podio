import { Router, type IRouter } from "express";
import healthRouter from "./health";
import zero3Router from "./zero3";
import zero3EventLifecycleRouter from "./zero3-event-lifecycle";

const router: IRouter = Router();

router.use(healthRouter);
router.use(zero3Router);
router.use(zero3EventLifecycleRouter);

export default router;
