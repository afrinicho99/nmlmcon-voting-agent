FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
