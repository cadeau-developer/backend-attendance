const { httpServerHandler } = require("cloudflare:node");
const app = require("./app");
app.listen(3000);
export default httpServerHandler({ port: 3000 });
