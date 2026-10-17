const BODY_LIMIT = 10 * 1024 * 1024;

module.exports = function jsonBodyParser(req, res, next) {
  if (!req.is("application/json")) return next();

  const hasBody =
    req.headers["transfer-encoding"] !== undefined ||
    Number(req.headers["content-length"]) > 0;
  if (!hasBody) return next();

  const contentType = req.get("content-type") || "";
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
  if (charset && !/^utf-?8$/i.test(charset[1])) {
    const error = new Error(`unsupported charset "${charset[1].toUpperCase()}"`);
    error.status = 415;
    return next(error);
  }

  const chunks = [];
  let size = 0;
  let failed = false;

  req.on("data", (chunk) => {
    if (failed) return;

    size += chunk.length;
    if (size > BODY_LIMIT) {
      failed = true;
      chunks.length = 0;
      const error = new Error("request entity too large");
      error.status = 413;
      next(error);
      req.resume();
      return;
    }

    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  req.on("end", () => {
    if (failed) return;

    let body = Buffer.concat(chunks, size).toString("utf8");
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

    const firstCharacter = body.match(/[^\x20\t\r\n]/);
    if (!firstCharacter) {
      req.body = {};
      return next();
    }

    if (firstCharacter[0] !== "{" && firstCharacter[0] !== "[") {
      const error = new SyntaxError("Unexpected token in JSON");
      error.status = 400;
      return next(error);
    }

    try {
      req.body = JSON.parse(body);
    } catch (error) {
      return next(error);
    }

    return next();
  });

  req.on("error", (error) => {
    if (failed) return;
    failed = true;
    next(error);
  });
};