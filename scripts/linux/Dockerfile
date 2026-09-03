# Sirube の AppImage を焼くためのビルド環境。
#
# ベースが 22.04 なのは趣味ではなく必須条件。AppImage は glibc を同梱しないので、
# ビルドホストの glibc がそのまま最低要求になる（Tauri 公式が「サポートしたい
# 最も古いベースで焼け」と明記）。手元の WSL は Ubuntu 24.04 = glibc 2.39 で、
# ここで焼くと 2.39 未満の環境で GLIBC_x.xx not found になる。22.04 は 2.35。
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# libwebkit2gtk-4.1-dev は Tauri v2 の必須依存。22.04 は標準リポジトリで提供する
# （20.04 には無い。これが「22.04 より下げられない」下限）。
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file git ca-certificates pkg-config \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
      libayatana-appindicator3-dev librsvg2-dev \
      desktop-file-utils unzip \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/root/.bun/bin:$PATH

# rust-toolchain.toml と同じ 1.98.0 に固定する。
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.98.0 --profile minimal

RUN curl -fsSL https://bun.sh/install | bash

# linuxdeploy（Tauri が AppImage 生成に使う）は FUSE を要求するが、コンテナには
# /dev/fuse が無い。展開して実行させることで回避する。--privileged を避けるため。
ENV APPIMAGE_EXTRACT_AND_RUN=1

WORKDIR /build
