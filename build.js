const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");
const files = ["index.html", "styles.css", "app.js"];
const apiUrl = process.env.EXPO_PUBLIC_API_URL || "https://api.poohter.com";

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

fs.writeFileSync(
  path.join(dist, "env.js"),
  `window.EXPO_PUBLIC_API_URL = ${JSON.stringify(apiUrl)};\n`
);

console.log("Static site ready in dist");
