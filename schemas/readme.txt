npx wrangler d1 execute d1_server --remote --file=schemas/schema.sql
 npx wrangler d1 execute d1_server --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
 npx wrangler d1 execute d1_server --remote --command="DROP TABLE users;"