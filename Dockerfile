FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY playwright.config.ts ./
COPY tests ./tests
COPY scripts ./scripts

CMD ["npm", "run", "test:report"]
