#!/bin/sh
set -e

echo "→ Применяю миграции Prisma..."
npx prisma migrate deploy

echo "→ Запускаю: $@"
exec "$@"
