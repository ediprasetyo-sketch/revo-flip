FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache qpdf poppler-utils
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN node server-fix.cjs && rm server-fix.cjs
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
