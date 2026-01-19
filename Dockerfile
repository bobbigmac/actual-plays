FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY package.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3000
CMD sh -c "npx prisma migrate deploy && npm run start"

