import { Router } from "express";
import healthRoutes from "./health.routes";

const routes = Router();

routes.use(healthRoutes);

export default routes;
