# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# --- зависимости ---
FROM base AS deps
COPY package.json package-lock.json* ./
# --ignore-scripts: postinstall (prisma generate) здесь упадёт — schema.prisma
# ещё не скопирована; prisma generate выполняется явно на этапе build ниже.
RUN npm ci --ignore-scripts

# --- сборка ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate только читает schema.prisma и не подключается к базе, но
# требует, чтобы DATABASE_URL вообще был задан как переменная окружения —
# на этапе сборки образа реального .env ещё нет, поэтому подставляем
# заглушку; настоящее значение приходит из .env в docker-compose.yml
# в рантайме и используется при next start / миграциях.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
# NEXT_PUBLIC_* вшиваются во фронтенд на этапе `next build`, а .env в образ не
# попадает (.dockerignore) — поэтому имя бота передаётся build-аргументом
# (см. build.args в docker-compose.yml), иначе invite-ссылка t.me/... пустая.
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=""
ARG NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME=""
ENV NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
ENV NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME=$NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME
RUN npx prisma generate
RUN npm run build

# --- рантайм ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
