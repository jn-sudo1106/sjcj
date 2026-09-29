# 允许外部覆盖基础镜像（默认使用部署机上已缓存的 node:22-slim 与 nginx:alpine）
ARG BUILD_IMAGE=node:22-slim
ARG RUNTIME_IMAGE=nginx:alpine
# 业务后端（9999）。前端构建（生产写保护 / 顶栏徽标按它判定）和 nginx 的 /api、/vrule、/rest、/oss 反代共用这一个值。
# 133 环境：--build-arg BACKEND_TARGET=http://115.227.21.133:9999
ARG BACKEND_TARGET=http://118.25.96.217:9999

FROM ${BUILD_IMAGE} AS builder

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
ARG BACKEND_TARGET
ENV VITE_API_PROXY_TARGET=${BACKEND_TARGET}

# npm run build 在根 package.json 里定义为 "npm --prefix app run build"
# 实际执行 vue-tsc -b && vite build，产物落在 app/dist
RUN npm --prefix app run build

# 阶段 2：用 nginx 镜像托管静态产物与网关路由
FROM ${RUNTIME_IMAGE}

# 自定义 server 配置：/sjcj/ 子路径 + gzip + 静态资源长缓存 + index.html 不缓存
COPY nginx.conf /etc/nginx/conf.d/default.conf
# OSS 下载服务与业务后端同机、固定 9102 端口（前端 ossPublicUrl 与 vite /oss 代理同一规则），跟着 BACKEND_TARGET 换主机
ARG BACKEND_TARGET
RUN sed -i -e "s#http://118.25.96.217:9999#${BACKEND_TARGET}#g" \
           -e "s#http://118.25.96.217:9102#${BACKEND_TARGET%:*}:9102#g" /etc/nginx/conf.d/default.conf

# 构建产物落到 nginx 默认站点下的 sjcj/ 子目录
COPY --from=builder /build/app/dist /usr/share/nginx/html/sjcj

EXPOSE 80

# 健康检查：拉一次 /sjcj/index.html。-slim 镜像里的 busybox 一般还带 wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/sjcj/index.html || exit 1
