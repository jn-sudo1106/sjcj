# syntax=docker/dockerfile:1.7

# 阶段 1：构建 Vue 3 静态产物
# node:22-alpine 与项目 vite 8 / vue-tsc 3 的 Node 版本要求对齐
FROM node:22-alpine AS builder

WORKDIR /build

# 先复制 lockfile，最大化 Docker 缓存命中（源码改动不会重装依赖）
COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix app --no-audit --no-fund

# 复制 app/ 全部源码（vite.config / tsconfig / src / public / index.html …）
COPY app/ ./app/

# 部署子路径：项目实际挂在 /sjcj/ 下；可用 --build-arg VITE_BASE=/other/ 覆盖
# 该变量在 vite.config.ts 的 build.base 里读取，影响 index.html 中静态资源的前缀
ARG VITE_BASE=/sjcj/
ENV VITE_BASE=${VITE_BASE}

# npm run build 在根 package.json 里定义为 "npm --prefix app run build"
# 实际执行 vue-tsc -b && vite build，产物落在 app/dist
RUN npm --prefix app run build

# 阶段 2：用本地的 nginx 镜像托管静态产物
FROM nginx:1.31.0-alpine-slim_amd64

# 自定义 server 配置：/sjcj/ 子路径 + gzip + 静态资源长缓存 + index.html 不缓存
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 构建产物落到 nginx 默认站点下的 sjcj/ 子目录
COPY --from=builder /build/app/dist /usr/share/nginx/html/sjcj

EXPOSE 80

# 健康检查：拉一次 /sjcj/index.html。-slim 镜像里的 busybox 一般还带 wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/sjcj/index.html || exit 1
