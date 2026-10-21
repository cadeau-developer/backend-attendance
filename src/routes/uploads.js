const express = require("express");
const { authenticate } = require("../middleware/auth");
const { saveImage } = require("../utils/uploads");

const router = express.Router();

// Save an image (base64 data URL) into the server's uploads folder and return
// its URL. Any signed-in user may upload; the image fields themselves are
// validated by the endpoints that store them.
router.post("/", authenticate, async (req, res) => {
  const image = req.body?.image ?? req.body?.photoUrl ?? req.body?.avatarUrl ?? req.body?.logoUrl;
  try {
    const url = await saveImage(image, req);
    res.status(201).json({ url });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Could not save the image" });
  }
});

module.exports = router;
