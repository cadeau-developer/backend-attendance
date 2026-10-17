import { httpServerHandler } from "cloudflare:node";
import createApp from "./app.js";
import jsonBodyParser from "./middleware/jsonBodyParser.js";
import WorkerRateLimitStore from "./middleware/WorkerRateLimitStore.js";

const app = createApp({
  jsonParser: jsonBodyParser,
  rateLimitStore: new WorkerRateLimitStore(),
});
app.listen(3000);

export default httpServerHandler({ port: 3000 });
