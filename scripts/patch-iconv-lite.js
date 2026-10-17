const fs = require("fs");
const path = require("path");

const iconvPath = require.resolve("iconv-lite/lib/index.js");
const source = fs.readFileSync(iconvPath, "utf8");

if (source.includes("streamsModule.default || streamsModule")) {
  process.exit(0);
}

const replacements = [
  [
    'var streams = require("./streams")(streamModule)',
    'var streamsModule = require("./streams")\n  var streams = (streamsModule.default || streamsModule)(streamModule)',
  ],
  [
    'require("./streams")(iconv);',
    'var streamsModule = require("./streams");\n        (streamsModule.default || streamsModule)(iconv);',
  ],
];

const replacement = replacements.find(([original]) => source.includes(original));
if (!replacement) {
  throw new Error(`Unsupported iconv-lite stream initialization in ${iconvPath}`);
}

fs.writeFileSync(
  iconvPath,
  source.replace(replacement[0], replacement[1]),
  "utf8"
);
console.log("Patched iconv-lite stream factory interop.");
