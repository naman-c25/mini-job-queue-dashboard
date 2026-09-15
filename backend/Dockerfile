# Build stage — needs devDependencies for the Nest CLI and TypeScript.
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage — production dependencies and compiled output only.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Hosting platforms inject PORT; the app falls back to 3000.
EXPOSE 3000

# Run as a non-root user.
USER node

CMD ["node", "dist/main.js"]
