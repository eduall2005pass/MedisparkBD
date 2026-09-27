# VM MySQL Persistent — medispark (20.219.193.182)

VM MariaDB 10.6 persistent on `medispark` (MEDISPARK RG, CentralIndia). Persisted: `mariadb.service` enabled + `Restart=always`, `datadir=/var/lib/mysql` on `/dev/root 62G`, `/etc/mysql/conf.d/medispark.cnf` + `bind-address=0.0.0.0`, NSG TCP 3306 Allow 300, nightly `/var/backups/mysql` cron.

## What was done (2026-09-23)

1. Installed `mariadb-server` 10.6.23 on VM, enabled `mariadb.service`.
2. Config: `/etc/mysql/mariadb.conf.d/50-server.cnf` -> `bind-address=0.0.0.0`, plus `/etc/mysql/conf.d/medispark.cnf`:
   ```
   [mysqld]
   max_connections=50
   innodb_buffer_pool_size=128M
   innodb_log_file_size=32M
   max_allowed_packet=64M
   skip-name-resolve
   character-set-server=utf8mb4
   ```
3. Created DB + user:
   ```sql
   CREATE DATABASE bloodare_medispark CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
   CREATE USER 'siam'@'%' IDENTIFIED BY 'MSdb-c2cee58de021f0ef4473ec7c-A9x';
   GRANT ALL PRIVILEGES ON bloodare_medispark.* TO 'siam'@'%';
   ```
4. Dump (5.4M, 2427 lines):
   `mysqldump --single-transaction --routines --triggers bloodare_medispark > /tmp/bloodare_medispark.sql`
5. Import: `mysql -u siam -p... bloodare_medispark < /tmp/bloodare_medispark.sql` -> 68 tables, 1148 admin_activity_logs, 270 exam_questions, etc.
6. Backup: `/usr/local/bin/mysql-backup.sh` nightly 02:00 via cron to `/var/backups/mysql/*.sql.gz` (7-day retention, 4.6M gz).
7. App code: `src/lib/mysql.ts:40` — `MYSQL_SSL=false` for VM.

## NSG — Done (2026-09-23 02:03 UTC)

- Added `medispark-nsg` Inbound `MariaDB` TCP 3306 `Any→Any` Priority `300` Allow via VM → Networking blade.
- Verified: `nc -zv 20.219.193.182 3306` → `succeeded`, `python3 check → 3306: OPEN`, `mysql -h 20.219.193.182 -e "SELECT 1"` → `1`, all APIs 200 (banners/hero/faqs/website-settings).
- Vercel env updated to `MYSQL_HOST=20.219.193.182 MYSQL_SSL=false` and site `https://medisparkbd.com` 200 with DB content.

## Switching the app — Done

Local dev (direct, persistent):
```bash
MYSQL_HOST=20.219.193.182 MYSQL_PORT=3306 MYSQL_DATABASE=bloodare_medispark MYSQL_USER=siam MYSQL_PASSWORD='MSdb-c2cee58de021f0ef4473ec7c-A9x' MYSQL_SSL=false pnpm dev
# fallback tunnel if needed: sshpass -p 'wp159333@A' ssh -L 3309:localhost:3306 -N siam@20.219.193.182 &
```

Production (Vercel `medisparkbd`):
- Env updated: `MYSQL_HOST=20.219.193.182`, `MYSQL_PORT=3306`, `MYSQL_DATABASE=bloodare_medispark`, `MYSQL_USER=siam`, `MYSQL_PASSWORD=MSdb-c2cee58de021f0ef4473ec7c-A9x`, `MYSQL_SSL=false` → Redeployed, APIs 200.

Keep `local.env`/`all.env` with both options commented.

## Verify

```bash
mysql -h 20.219.193.182 -P 3306 -u siam -p... -e "SELECT COUNT(*) FROM bloodare_medispark.students;"
# or via tunnel
mysql -h 127.0.0.1 -P 3309 -u siam -p... -e "SELECT COUNT(*) FROM bloodare_medispark.students;"
```
Counts should match expected: students 17, exams 6, exam_questions 270, etc.
