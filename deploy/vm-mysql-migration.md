# VM MySQL — setup & migration notes

> All values below are placeholders. Real host / user / password live in
> GitHub repo secrets (`VM_HOST`, `VM_USER`, `VM_PASSWORD`, `PROD_ENV`)
> and local `.env` files — **never commit real credentials to this repo.**

VM MariaDB persistent setup: `mariadb.service` enabled with restart policy,
tuned `max_connections` / InnoDB pool, nightly backup cron.

## What was done

1. Installed `mariadb-server` on the VM, enabled `mariadb.service`.
2. Server config (tuning only — no secrets here):
   ```
   [mysqld]
   max_connections=50
   innodb_buffer_pool_size=128M
   innodb_log_file_size=32M
   max_allowed_packet=64M
   skip-name-resolve
   character-set-server=utf8mb4
   ```
3. Created DB + least-privilege user (run on the VM, password from your
   password manager — do not paste it into any file):
   ```sql
   CREATE DATABASE <DB_NAME> CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
   CREATE USER '<DB_USER>'@'%' IDENTIFIED BY '<DB_PASSWORD>';
   GRANT ALL PRIVILEGES ON <DB_NAME>.* TO '<DB_USER>'@'%';
   ```
4. Dumped the previous database:
   `mysqldump --single-transaction --routines --triggers <DB_NAME> > /tmp/app.sql`
5. Imported on the VM: `mysql -u <DB_USER> -p <DB_NAME> < /tmp/app.sql`
6. Nightly backup via cron (compressed dumps, 7-day retention).
7. App code: `src/lib/mysql.ts` — `MYSQL_SSL=false` for this VM.

## Firewall

- Inbound `MariaDB` TCP 3306 Allow rule added on the VM network security group.
- Verified with `nc` / `mysql -h <DB_HOST> -e "SELECT 1"` and the app APIs.

## Switching the app

Local dev (direct, persistent):
```bash
MYSQL_HOST=<DB_HOST> MYSQL_PORT=3306 MYSQL_DATABASE=<DB_NAME> \
  MYSQL_USER=<DB_USER> MYSQL_PASSWORD='<DB_PASSWORD>' MYSQL_SSL=false pnpm dev
# fallback SSH tunnel if the port is restricted:
# ssh -L 3309:localhost:3306 -N <SSH_USER>@<DB_HOST> &
# then use MYSQL_HOST=127.0.0.1 MYSQL_PORT=3309
```

Production (Vercel): set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`,
`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_SSL=false` in the project dashboard
(or keep them inside the `PROD_ENV` repo secret used by `vm-deploy.yml`),
then redeploy.

Keep `local.env`/`all.env` (git-ignored) with both options commented.

## Verify

```bash
mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p -e "SELECT COUNT(*) FROM <DB_NAME>.students;"
# or via tunnel
mysql -h 127.0.0.1 -P 3309 -u <DB_USER> -p -e "SELECT COUNT(*) FROM <DB_NAME>.students;"
```
Row counts should match the expected snapshot noted at migration time.
