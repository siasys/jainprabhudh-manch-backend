// logger.js
const winston = require("winston");
const newrelicFormatter = require("@newrelic/winston-enricher")(winston);

const logger = winston.createLogger({
  level: "info",
  // New Relic formatter ko yahan add karein
  format: winston.format.combine(newrelicFormatter(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    // Aap chahein toh yahan File transport bhi add kar sakte hain
  ],
});

module.exports = logger;
