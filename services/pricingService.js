const PricingConfig = require('../model/PaymentModels/pricingConfigModel');

// Default prices (fallback if no config exists)
const DEFAULT_PRICES = {
    vyapar: 1001 * 100, // ₹1001 in paise
    biodata: 501 * 100  // ₹501 in paise
};
/**
 * Get current price for an entity type
 * @param {string} entityType - The type of entity (vyapar, biodata)
 * @returns {Promise<number>} - The price in paise
 */
const getPrice = async (entityType) => {
    try {
        const pricingConfig = await PricingConfig.findOne({ entityType });
        if (pricingConfig) {
            return pricingConfig.amount;
        }
        // If no config exists, use default price
        return DEFAULT_PRICES[entityType] || 0;
    } catch (error) {
        console.error(`Error fetching price for ${entityType}:`, error);
        // Fallback to default price on error
        return DEFAULT_PRICES[entityType] || 0;
    }
};

module.exports = {
    getPrice,
    DEFAULT_PRICES
};
