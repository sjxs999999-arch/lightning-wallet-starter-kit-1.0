FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:3001/api/v1
ARG VITE_FLASH_LOAN_URL=http://localhost:32104
ARG VITE_WALLETCONNECT_PROJECT_ID=
ARG VITE_EVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARG VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG VITE_SOLANA_NETWORK=devnet
ARG VITE_TRON_RPC_URL=https://nile.trongrid.io
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FLASH_LOAN_URL=$VITE_FLASH_LOAN_URL
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_EVM_RPC_URL=$VITE_EVM_RPC_URL
ENV VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL
ENV VITE_SOLANA_NETWORK=$VITE_SOLANA_NETWORK
ENV VITE_TRON_RPC_URL=$VITE_TRON_RPC_URL
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @lightning/core && npm run build -w @lightning/web
FROM nginx:1.27-alpine
COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4173/healthz || exit 1
