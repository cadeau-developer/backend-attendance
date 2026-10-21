const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Every image (student photos, avatars, school logos) is stored as a file in
// this folder instead of being kept as base64 inside the database.
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // decoded binary size (mobile caps at 2 MB)

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function uploadError(message, status = 400) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

// Public URL for a stored file, built from the incoming request so it works on
// localhost, the hosted API domain, or any future domain.
function publicUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

// Saves a base64 data URL into the uploads folder and returns its public URL.
async function saveImage(dataUrl, req) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw uploadError("image must be a data URL (data:image/...;base64,...)");
  }

  const match = dataUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw uploadError("image must be a base64-encoded data URL");
  }

  const mime = match[1].toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw uploadError("Only JPEG, PNG, WebP, GIF or HEIC images are allowed");
  }

  const base64 = match[2].replace(/\s+/g, "");
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (e) {
    throw uploadError("image could not be decoded");
  }
  if (buffer.length === 0) {
    throw uploadError("image is empty");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw uploadError("Image must be smaller than 5 MB");
  }

  const filename = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return publicUrl(req, filename);
}

// Normalizes an image field before it is stored: data URLs are saved into the
// uploads folder (returning the file URL); anything else (an existing URL or
// null) is passed through unchanged.
async function imageRef(value, req) {
  if (typeof value !== "string" || !value.startsWith("data:")) {
    return value || null;
  }
  return saveImage(value, req);
}

module.exports = { UPLOADS_DIR, saveImage, imageRef, publicUrl };
