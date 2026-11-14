# 允许外部覆盖基础镜像（默认使用部署机上已缓存的 node:22-slim 与 nginx:alpine）
ARG BUILD_IMAGE=node:22-slim
ARG RUNTIME_IMAGE=nginx:alpine
# 业务后端（9999）/ OSS 下载服务（9102）。前端构建（生产写保护 / 顶栏徽标按业务后端判定）和 nginx 的
# /api、/vrule、/rest、/oss 反代共用这两个值；两者可以不同机（2026-11-12 起 133 业务后端走内网 192.168.1.30，
# 而 OSS 在 192.168.1.80:9102）。
# 133 环境：--build-arg BACKEND_TARGET=http://192.168.1.30:9999 --build-arg OSS_TARGET=http://192.168.1.80:9102
ARG BACKEND_TARGET=http://118.25.96.217:9999
ARG OSS_TARGET=http://118.25.96.217:9102

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
# OSS 的独立 origin（前端「新窗口打开」要绝对地址；OSS 可能与业务后端不同机，不能按后端端口推）
ARG OSS_TARGET
ENV VITE_OSS_PUBLIC_TARGET=${OSS_TARGET}
# 打开新建通道（siteCreate / 网站下添加源 / 批量导入）：本地靠 app/.env.local，但它被 .dockerignore 排除，
# 不设的话部署出去的包新建全走 mock、真实网站报「网站不存在」。实际放行哪些主机看 CREATE_ALLOWED_BACKEND_HOSTS。
ENV VITE_SITE_CREATE_TARGET=production

# npm run build 在根 package.json 里定义为 "npm --prefix app run build"
# 实际执行 vue-tsc -b && vite build，产物落在 app/dist
RUN npm --prefix app run build

# 阶段 2：用 nginx 镜像托管静态产物与网关路由
FROM ${RUNTIME_IMAGE}

# 自定义 server 配置：/sjcj/ 子路径 + gzip + 静态资源长缓存 + index.html 不缓存
COPY nginx.conf /etc/nginx/conf.d/default.conf
# OSS 下载服务固定 9102 端口（前端 ossPublicUrl 与 vite /oss 代理同一规则）：默认与业务后端同机，
# 但允许用 OSS_TARGET 单独指定（2026-11-12：133 业务后端切内网 192.168.1.30，OSS 在 192.168.1.80:9102）。
ARG BACKEND_TARGET
ARG OSS_TARGET
RUN sed -i -e "s#http://118.25.96.217:9999#${BACKEND_TARGET}#g" \
           -e "s#http://118.25.96.217:9102#${OSS_TARGET}#g" /etc/nginx/conf.d/default.conf
# Runner 管理服务只认 217 的登录，非 prod 目标去掉这条路由（否则 401 会把用户踢回登录页）
RUN if [ "${BACKEND_TARGET}" != "http://118.25.96.217:9999" ]; then \
      sed -i '/# BEGIN runner-management/,/# END runner-management/d' /etc/nginx/conf.d/default.conf; \
    fi

# 构建产物落到 nginx 默认站点下的 sjcj/ 子目录
COPY --from=builder /build/app/dist /usr/share/nginx/html/sjcj

EXPOSE 80

# 健康检查：拉一次 /sjcj/index.html。-slim 镜像里的 busybox 一般还带 wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/sjcj/index.html || exit 1
