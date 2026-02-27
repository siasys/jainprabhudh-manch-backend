// logger.js
const winston = require("winston");
const newrelicFormatter = require("@newrelic/winston-enricher")(winston);

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(newrelicFormatter(), winston.format.json()),
  transports: [
    new winston.transports.File({
      filename: "newrelic_agent.log",
    }),
  ],
});

module.exports = logger;
