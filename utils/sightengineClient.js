// sightengineClient.js
const sightengineClient = require('sightengine')(
  process.env.SIGHTENGINE_USER,
  process.env.SIGHTENGINE_SECRET
);

module.exports = sightengineClient; // directly export the client
