read -rsp 'New admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
dc exec -T -e ADMIN_PASSWORD backend-node \
  node --input-type=module -e '
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
const p = process.env.ADMIN_PASSWORD || "";
if (p.length < 16) throw new Error("Password too short");
const c = new MongoClient(process.env.MONGODB_URI);
try {
  await c.connect();
  const r = await c.db("movieweb").collection("users").updateOne(
    { email: "admin@movieweb.com", role: "admin" },
    { $set: { password: await bcrypt.hash(p, 12),
              updatedAt: new Date() } }
  );
  if (r.matchedCount !== 1) throw new Error("Expected one admin");
  console.log("ADMIN_PASSWORD_UPDATED");
} finally { await c.close(); }
'
unset ADMIN_PASSWORD
