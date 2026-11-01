import { Router, type IRouter } from "express";
import healthRouter from "./health";
import zero3Router from "./zero3";

const router: IRouter = Router();

router.use(healthRouter);
router.use(zero3Router);

export default router;
