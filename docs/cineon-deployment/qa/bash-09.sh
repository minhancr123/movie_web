dc exec -T backend-node node --input-type=module -e '
import { MongoClient } from "mongodb";
const c = new MongoClient(process.env.MONGODB_URI);
try {
  await c.connect();
  console.log(await c.db("movieweb").command({ ping: 1 }));
} finally { await c.close(); }
'
