FROM node:20

ENV DEBIAN_FRONTEND=noninteractive

# VS Code version baked into the image. The Playwright VS Code configs read
# VSCODE_TEST_VERSION and use it as their `vscodeVersion`, which makes
# @vscode/test-electron look for an existing install at
# .vscode-test/worker-0/vscode-linux-x64-<version> and skip the 241 MB download.
# Bump this ARG (and rebuild the image) to move CI to a newer VS Code.
ARG VSCODE_TEST_VERSION=1.123.0
ENV VSCODE_TEST_VERSION=${VSCODE_TEST_VERSION}

# Where Playwright stores its browser binaries. Setting it as an image ENV makes
# Playwright reuse the baked chromium instead of downloading per run.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        jq \
        curl \
        xvfb \
        xauth \
        libgtk-3-0 \
        libxss1 \
        libasound2 \
        libgbm1 \
        libnspr4 \
        libnss3 \
    && rm -rf /var/lib/apt/lists/*

# Pre-download VS Code and the Playwright chromium browser so CI never pays the
# ~241 MB VS Code download (and any browser download) at test time.
# Versions are pinned to match package-lock.json so the baked install matches
# what the repo's devDependencies expect:
#   - @vscode/test-electron@2.5.2  (does the VS Code download/unzip)
#   - @playwright/test@1.52.0      (provides the `playwright` CLI)
# A throwaway install is used so the image system node_modules stays clean; only
# the downloaded artifacts under /opt/vscode-test and /opt/pw-browsers persist.
RUN mkdir -p /tmp/bake /opt/vscode-test/worker-0 /opt/pw-browsers \
    && cd /tmp/bake \
    && npm init -y \
    && npm install --no-save @playwright/test@1.52.0 @vscode/test-electron@2.5.2 \
    && npx playwright install chromium \
    && node -e " \
        const { downloadAndUnzipVSCode } = require('@vscode/test-electron'); \
        downloadAndUnzipVSCode({ \
          cachePath: '/opt/vscode-test/worker-0', \
          version: process.env.VSCODE_TEST_VERSION, \
        }).then(p => console.log('baked VS Code at', p)) \
    " \
    && cd / && rm -rf /tmp/bake
