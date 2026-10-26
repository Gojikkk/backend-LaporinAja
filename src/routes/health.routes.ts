import { Router } from "express";

const healthRoutes = Router();

healthRoutes.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

export default healthRoutes;
