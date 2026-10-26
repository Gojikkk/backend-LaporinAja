import express from "express";
import routes from "./routes";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(routes);

export default app;
