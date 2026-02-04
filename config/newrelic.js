'use strict'

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'Jaintav Backend'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: {
    enabled: true
  },
  logging: {
    level: 'info'
  }
}
