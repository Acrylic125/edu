import { spawnSync } from 'node:child_process';
import { z } from 'zod';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const parsed = z.tuple([
  z.string().min(1).max(128),
  z.enum(['free', 'pro']),
  z.enum(['--local', '--remote']),
]).safeParse(args);
if (!parsed.success) {
  console.error('Usage: pnpm plan:set <user-id> <free|pro> <--local|--remote>');
  process.exit(1);
}
const [userId, plan, target] = parsed.data;
const sql = `UPDATE user SET plan = '${plan}' WHERE id = '${userId.replaceAll("'", "''")}' RETURNING id, plan;`;
const command = ['exec', 'wrangler', 'd1', 'execute', 'edu-api', target, '--command', sql];
if (target === '--remote') command.push('--env', 'production-ben');
const result = spawnSync('pnpm', command, { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
