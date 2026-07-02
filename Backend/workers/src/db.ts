import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environmental variables
dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/T-Clone?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const db = new PrismaClient({ adapter });
export default db;
