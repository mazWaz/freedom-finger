# Image kecil untuk bun-web: server dan halaman dikompilasi menjadi satu file executable (bun build
# --compile; HTML, CSS, huruf, dan exceljs ikut di dalamnya), lalu dijalankan di Alpine polos.
# Build: docker build -t freedom-finger-bun-web .   Jalankan: lihat compose.yaml.

FROM oven/bun:1.3-alpine AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server server
COPY web web
# tahap ini dibuang: bundler boleh menulis apa pun di sini (di folder kerja ia bisa menimpa web/index.html)
RUN bun build --compile --minify server/index.ts --outfile ff-web

FROM alpine:3.24
# executable Bun untuk musl butuh pustaka C++ bawaan Alpine
RUN apk add --no-cache libstdc++ libgcc && mkdir /data && chown 1000:1000 /data
COPY --from=build /src/ff-web /usr/local/bin/ff-web
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
USER 1000:1000
VOLUME /data
EXPOSE 3000
CMD ["ff-web"]
