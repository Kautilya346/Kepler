require('dotenv').config();
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'super-secret-key-t-clone-orchestrator';

const payload = {
  id: 'usr_test_cli',
  username: 'cli_tester',
  role: 'developer'
};

const token = jwt.sign(payload, secret, { expiresIn: '7d' });

console.log('==================================================');
console.log('🔑 Generated Test JWT Token (Valid for 7 days):');
console.log('==================================================');
console.log(token);
console.log('==================================================');
console.log('Usage example:');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3001/api/workflows`);
console.log('==================================================');
