// Heuristic scan of publishable files. Findings print paths/rule names, never values.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const rules = [
  ['literal-user-secret', /(?:ZEPP_EMAIL|ZEPP_PASSWORD|MCP_AUTH_TOKEN)["']?\s*[:=]\s*["'](?!fixture(?:-|@example\.invalid)|\$\{|["'])[^\r\n"']+/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['cloudflare-account-id', /account_id\s*["']?\s*[:=]\s*["'][a-f0-9]{32}["']/i],
  ['deployed-hostname', /\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i],
  ['deployment-version-id', /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i],
  ['credential-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['literal-account-id', /\buser_?id["']?\s*[:=]\s*["']?\d{3,}/i],
  ['local-user-path', /\/home\/[^/\s]+\//],
  ['non-example-email', /\b[A-Z0-9._%+-]+@(?!example\.(?:invalid|com)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
];
const findings = [];
for (const file of files) {
  if (/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(file) && file !== '.dev.vars.example') findings.push([file, 'secret-file']);
  const content = readFileSync(file, 'utf8');
  for (const [name, rule] of rules) if (rule.test(content)) findings.push([file, name]);
}
const candidates = ['.env', '.env.production', '.dev.vars', '.dev.vars.local', '.wrangler/state/test', 'output/private.json', 'dist/index.js', 'test/fixtures/local/private.json'];
const ignored = execFileSync('git', ['check-ignore', '--stdin'], { input: candidates.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n');
for (const file of candidates) if (!ignored.includes(file)) findings.push([file, 'not-ignored']);
console.log(JSON.stringify({ scanned_files: files.length, ignore_checks: candidates.length, findings }));
if (findings.length) process.exitCode = 1;
