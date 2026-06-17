'use strict';

// Refuses to run `prisma migrate deploy` against the PRODUCTION database.
//
// This backend keeps its prod schema in sync with `prisma db push` (see the start
// command in railway.json / nixpacks.toml), NOT migrations. Running `migrate deploy`
// against the db-push'd prod DB tries to re-create objects that already exist, fails,
// and records a FAILED migration in _prisma_migrations — after which `db push`
// REFUSES to run, so the backend crash-loops on every boot (a full API outage).
// This guard makes an accidental `npm run migrate` on prod a no-op instead.
//
// Local dev migrations are unaffected. If you ever truly must migrate prod, run:
//   ALLOW_PROD_MIGRATE=1 npm run migrate

const url = process.env.DATABASE_URL || '';
const looksProd = process.env.NODE_ENV === 'production' || /neon\.tech/i.test(url);

if (looksProd && process.env.ALLOW_PROD_MIGRATE !== '1') {
  console.error('\n⛔  Refusing to run `prisma migrate deploy` against PRODUCTION.');
  console.error('    This backend syncs its schema via `prisma db push` on deploy —');
  console.error('    never run migrate deploy on prod. Doing so records a failed migration');
  console.error('    that makes `db push` refuse to boot, taking the API down.\n');
  console.error('    Schema changes: edit schema.prisma and push to main (db push applies it).');
  console.error('    If you are 100% certain you need this: ALLOW_PROD_MIGRATE=1 npm run migrate\n');
  process.exit(1);
}
