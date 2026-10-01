# Image program server Freedom Finger: file rilis Linux (satu file statis; SDK, SQLite, zona waktu, dan
# sertifikat TLS sudah di dalamnya) di image kosong, ±7 MB. Dipakai compose.yaml di examples/bun-web
# dan examples/next-web. Versi lain: --build-arg VERSION=v0.5.0 (bawaan: rilis terbaru).

FROM alpine:3.24 AS unduh
ARG VERSION=latest
ARG TARGETARCH
WORKDIR /unduh
RUN set -eu; \
    case "$TARGETARCH" in amd64) a=linux-x64 ;; arm64) a=linux-arm64 ;; *) echo "arsitektur $TARGETARCH tidak didukung" >&2; exit 1 ;; esac; \
    rilis=https://github.com/mazWaz/freedom-finger/releases; \
    if [ "$VERSION" = latest ]; then url=$rilis/latest/download; else url=$rilis/download/$VERSION; fi; \
    wget -q "$url/freedom-finger-$a" "$url/SHA256SUMS"; \
    grep " freedom-finger-$a\$" SHA256SUMS | sha256sum -c -s; \
    mv "freedom-finger-$a" freedom-finger; \
    chmod 755 freedom-finger; \
    mkdir /data

FROM scratch
COPY --from=unduh /unduh/freedom-finger /freedom-finger
COPY --from=unduh --chown=1000:1000 /data /data
USER 1000:1000
VOLUME /data
EXPOSE 8013
ENTRYPOINT ["/freedom-finger", "--data", "/data"]
CMD ["serve"]
