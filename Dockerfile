FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy root workspace configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy packages and microservices source code
COPY data ./data
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN mkdir -p .secrets/certificates && cp data/certificates/supabase-ca.crt .secrets/certificates/supabase-ca.crt

# Install dependencies across all workspace packages
RUN pnpm install

# Build target (default builds all workspace packages with Turborepo)
ARG SERVICE=all
ENV SERVICE=${SERVICE}
ENV NEXT_TELEMETRY_DISABLED=1

# Only public web configuration is available to the image build. Configure
# RPC, price-provider credentials and database secrets as runtime variables.
# Next validates runtime server configuration when it starts.
ARG NETWORK_MODE
ARG CHAIN_ID
ARG CHAIN_NAME
ARG EXPLORER_URL
ARG NATIVE_CURRENCY_NAME
ARG NATIVE_CURRENCY_SYMBOL
ARG NATIVE_CURRENCY_DECIMALS
ARG USDG_ADDRESS
ARG BACKEND_API_URL
ARG PROTOCOL_ADDRESSES
ARG TRADING_ENABLED
ARG UI_POLL_INTERVAL_MS
ARG LENDING_ENABLED
ARG LENDING_DEPLOYMENT_JSON
ARG LENDING_RECEIPT_CONFIRMATIONS
ARG LENDING_RECEIPT_TIMEOUT_MS
ARG USDG_FAUCET_URL
ARG MARGIN_TRADING_ENABLED
ARG MARGIN_DEPLOYMENT_JSON
ARG MARKET_DEPLOYMENTS_JSON
ARG PONS_TRADING_ENABLED
ARG PONS_DEPLOYMENT_JSON
ARG TOKEN_CA
ARG NEXT_PUBLIC_TOKEN_CA

RUN printf '%s\n' \
  "NETWORK_MODE=${NETWORK_MODE}" \
  "CHAIN_ID=${CHAIN_ID}" \
  "CHAIN_NAME=${CHAIN_NAME}" \
  "EXPLORER_URL=${EXPLORER_URL}" \
  "NATIVE_CURRENCY_NAME=${NATIVE_CURRENCY_NAME}" \
  "NATIVE_CURRENCY_SYMBOL=${NATIVE_CURRENCY_SYMBOL}" \
  "NATIVE_CURRENCY_DECIMALS=${NATIVE_CURRENCY_DECIMALS}" \
  "USDG_ADDRESS=${USDG_ADDRESS}" \
  "BACKEND_API_URL=${BACKEND_API_URL}" \
  "PROTOCOL_ADDRESSES=${PROTOCOL_ADDRESSES}" \
  "TRADING_ENABLED=${TRADING_ENABLED}" \
  "UI_POLL_INTERVAL_MS=${UI_POLL_INTERVAL_MS}" \
  "LENDING_ENABLED=${LENDING_ENABLED}" \
  "LENDING_DEPLOYMENT_JSON=${LENDING_DEPLOYMENT_JSON}" \
  "LENDING_RECEIPT_CONFIRMATIONS=${LENDING_RECEIPT_CONFIRMATIONS}" \
  "LENDING_RECEIPT_TIMEOUT_MS=${LENDING_RECEIPT_TIMEOUT_MS}" \
  "USDG_FAUCET_URL=${USDG_FAUCET_URL}" \
  "MARGIN_TRADING_ENABLED=${MARGIN_TRADING_ENABLED}" \
  "MARGIN_DEPLOYMENT_JSON=${MARGIN_DEPLOYMENT_JSON}" \
  "MARKET_DEPLOYMENTS_JSON=${MARKET_DEPLOYMENTS_JSON}" \
  "PONS_TRADING_ENABLED=${PONS_TRADING_ENABLED:-false}" \
  "PONS_DEPLOYMENT_JSON=${PONS_DEPLOYMENT_JSON}" \
  "TOKEN_CA=${TOKEN_CA:-${NEXT_PUBLIC_TOKEN_CA}}" \
  "NEXT_PUBLIC_TOKEN_CA=${NEXT_PUBLIC_TOKEN_CA:-${TOKEN_CA}}" \
  > /app/apps/web/.env

RUN if [ "$SERVICE" = "backend" ]; then \
      pnpm run build:backend; \
    elif [ "$SERVICE" = "all" ]; then \
      pnpm run build; \
    else \
      pnpm --filter=@levier/${SERVICE} build; \
    fi

# Expose common service ports (Next.js web: 3000/dynamic, API: 3001/dynamic)
EXPOSE 3000 3001 8080

CMD ["sh", "-c", "if [ \"$SERVICE\" = \"backend\" ]; then node scripts/run-all-backend.mjs; else pnpm --filter=@levier/${SERVICE:-web} start; fi"]
