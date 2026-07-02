import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';

// Load connection string
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/T-Clone?schema=public';

// Configure connection pool
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Instantiate database client with PG driver adapter
export const db = new PrismaClient({ adapter });
export default db;
