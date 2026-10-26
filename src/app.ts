import express from "express";
import { env } from "./config/env";
import { corsAndOrigin } from "./middlewares/security";
import { errorHandler } from "./middlewares/errors";
import routes from "./routes";
import { HttpError } from "./utils/http-error";

const app = express();

app.disable("x-powered-by");
app.use(corsAndOrigin);
app.use(express.json({ limit: env.maxUploadRequestBytes }));
app.use(routes);
app.use((request, _response, next) => {
  next(new HttpError(404, "NOT_FOUND", "Endpoint tidak ditemukan"));
});
app.use(errorHandler);

export default app;
