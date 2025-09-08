FROM node:18

WORKDIR /usr/src/app

COPY services/email-cleaner/package*.json ./

RUN npm install

COPY services/email-cleaner/. .

EXPOSE 8080

CMD [ "npm", "start" ]
