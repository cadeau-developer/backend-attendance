function normalizePhone(raw) {
  let p = String(raw || "").replace(/[\s-]/g, "");
  if (p.startsWith("+250")) p = p.slice(4);
  return p;
}

function isRwPhone(raw) {
  return /^07[2389]\d{7}$/.test(normalizePhone(raw));
}

const PHONE_ERROR = "Phone must be 10 digits starting with 078, 079, 072 or 073.";

module.exports = { normalizePhone, isRwPhone, PHONE_ERROR };