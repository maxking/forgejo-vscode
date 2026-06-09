FROM node:20

ENV DEBIAN_FRONTEND=noninteractive

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
