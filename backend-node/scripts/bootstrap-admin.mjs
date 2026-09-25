import { connectDB, getDB } from '../config/database.js';
import { readAppConfig } from '../config/runtime.js';
import { bootstrapAdmin } from '../services/adminBootstrap.js';
import bcrypt from 'bcryptjs';

async function main() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
        process.exit(1);
    }

    const config = readAppConfig(process.env);
    
    await connectDB(config.databaseUrl || process.env.MONGO_URI || 'mongodb://localhost:27017/cineon');
    
    const db = getDB();
    const users = db.collection('users'); // Adjust based on how 'users' collection is retrieved if it uses mongoose

    try {
        const result = await bootstrapAdmin({
            users,
            email,
            password,
            hashPassword: async (pwd) => await bcrypt.hash(pwd, 10),
            now: () => new Date()
        });

        console.log(result); // 'created' or 'exists'
        process.exit(0);
    } catch (err) {
        console.error('Error bootstrapping admin:', err);
        process.exit(1);
    }
}

main();
