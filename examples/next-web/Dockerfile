# Image kecil untuk next-web: `output: 'standalone'` (next.config.ts) hanya menyalin file yang dipakai
# server, lalu dijalankan dengan binary Node di Alpine polos (tanpa npm, yarn, dan corepack).
# Build: docker build -t freedom-finger-next-web .   Jalankan: lihat compose.yaml.

FROM node:24-alpine3.24 AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# sharp (±36 MB) hanya untuk optimasi gambar, yang dimatikan di next.config.ts
RUN npm run build && rm -rf .next/standalone/node_modules/sharp .next/standalone/node_modules/@img

FROM alpine:3.24
# binary Node dari image node yang sama versi Alpine-nya; butuh pustaka C++ bawaan Alpine
RUN apk add --no-cache libstdc++ libgcc && mkdir /data && chown 1000:1000 /data
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static .next/static
COPY --from=build /src/public public
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
USER 1000:1000
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
