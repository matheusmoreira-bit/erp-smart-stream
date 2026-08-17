FROM node:22-alpine AS builder
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# copy sources and build
COPY . .
ENV NODE_ENV=production
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_ENABLE_FAKE_AUTH
ARG VITE_FAKE_AUTH_EMAIL
ARG VITE_FAKE_AUTH_PASSWORD
ARG VITE_FAKE_AUTH_IS_ADMIN

# Vite bakes these values at build time. Empty build args override .env and
# create a bundle that crashes before React mounts, so unset blanks first.
RUN if [ -z "${VITE_SUPABASE_URL:-}" ]; then unset VITE_SUPABASE_URL; fi; \
    if [ -z "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ]; then unset VITE_SUPABASE_PUBLISHABLE_KEY; fi; \
    if [ -z "${VITE_SUPABASE_PROJECT_ID:-}" ]; then unset VITE_SUPABASE_PROJECT_ID; fi; \
    if [ -z "${VITE_ENABLE_FAKE_AUTH:-}" ]; then unset VITE_ENABLE_FAKE_AUTH; fi; \
    if [ -z "${VITE_FAKE_AUTH_EMAIL:-}" ]; then unset VITE_FAKE_AUTH_EMAIL; fi; \
    if [ -z "${VITE_FAKE_AUTH_PASSWORD:-}" ]; then unset VITE_FAKE_AUTH_PASSWORD; fi; \
    if [ -z "${VITE_FAKE_AUTH_IS_ADMIN:-}" ]; then unset VITE_FAKE_AUTH_IS_ADMIN; fi; \
    npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["/bin/sh", "-c", "nginx -g 'daemon off;'"]
