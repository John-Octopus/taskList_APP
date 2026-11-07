import { listWorkspaceSessions } from './store.js';

process.env.DSH_HOME = 'C:/Users/ZCC/.dsh';
const rows = await listWorkspaceSessions({ get: () => undefined });
console.log('rows:', rows.length);
for (const row of rows) {
  console.log(
    [
      row.id.slice(0, 24),
      row.subagent ? 'sub ' : 'main',
      new Date(row.updatedAt).toISOString(),
      String(row.bytes).padStart(8),
      row.title,
    ].join('  '),
  );
}
