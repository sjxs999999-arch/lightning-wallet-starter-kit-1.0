FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:3001/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @lightning/core && npm run build -w @lightning/web
EXPOSE 4173
CMD ["npm","run","start","-w","@lightning/web"]
