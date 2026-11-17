# Linux with pcscd and vsmartcard, to run the virtual card tests from any
# machine with Docker (see README.md here). Matches CI: Ubuntu 26.04,
# pcsc-lite 2.4.1.
FROM ubuntu:26.04
ARG NODE_VERSION=24.11.1
RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        build-essential python3 libpcsclite-dev pcscd \
        vsmartcard-vpcd vsmartcard-vpicc python3-pycryptodome \
        ca-certificates curl xz-utils >/dev/null && \
    arch=$(dpkg --print-architecture | sed 's/amd64/x64/') && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
        | tar -xJ -C /usr/local --strip-components=1 && \
    rm -rf /var/lib/apt/lists/*
COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
