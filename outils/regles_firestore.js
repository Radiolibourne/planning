// Affiche les règles de sécurité Firestore, générées par le même code que le site (src/online_core.js).
// Usage : CODE_EQUIPE=... ADMIN_UID=uid1,uid2 node outils/regles_firestore.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = path.join(__dirname, "..", "src");
const code = ["zip.js", "engine.js", "export.js", "online_core.js"].map((f) => fs.readFileSync(path.join(src, f), "utf8")).join("\n");
const ctx = vm.createContext({ TextEncoder, TextDecoder, Intl, console });
vm.runInContext(code + "\n;this.__regles = firestoreRules;", ctx);
const equipe = (process.env.CODE_EQUIPE || "").trim();
const uids = (process.env.ADMIN_UID || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
if (!/^[A-Za-z0-9-]{12,60}$/.test(equipe)) { console.error("CODE_EQUIPE absent ou invalide."); process.exit(2); }
if (!uids.length || uids.some((u) => !/^[A-Za-z0-9]{10,64}$/.test(u))) { console.error("ADMIN_UID absent ou invalide."); process.exit(2); }
process.stdout.write(ctx.__regles(equipe, uids));
