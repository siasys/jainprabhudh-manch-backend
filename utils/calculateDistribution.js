const Sangh = require('../model/SanghModels/hierarchicalSanghModel');

const calculateDistribution = async ({ amount = 1100, sanghId }) => {
    const sangh = await Sangh.findById(sanghId).populate("parentSangh");
    console.log("🔹 Found Sangh:", sangh);
    if (!sangh) {
      throw new Error(`Sangh with ID ${sanghId} not found`);
    }

  let distribution = {};
  let details = {
    city: null,
    district: null,
    state: null,
    country: null,
    foundation: { amount: 300 } // default foundation amount
  };

  // Country-level Sangh payment logic
  if (sangh.level === "country") {
    details.country = { sanghId: sangh._id, amount: 500 }; // 500 to country
    details.foundation = { amount: 600 }; // 600 to foundation for country-level Sangh
  }

  // If the Sangh is at city, district, or state level, handle accordingly
  else if (sangh.level === "city") {
    const district = await Sangh.findById(sangh.parentSangh);
    const state = await Sangh.findById(district.parentSangh);
    const country = await Sangh.findById(state.parentSangh);

    details.city = { sanghId: sangh._id, amount: 500 };
    details.district = { sanghId: district._id, amount: 100 };
    details.state = { sanghId: state._id, amount: 100 };
    details.country = { sanghId: country._id, amount: 100 };
    details.foundation = { amount: 300 }; // Foundation gets 300 for city-level sangh
  } 

  else if (sangh.level === "district") {
    const state = await Sangh.findById(sangh.parentSangh);
    const country = await Sangh.findById(state.parentSangh);

    details.district = { sanghId: sangh._id, amount: 500 };
    details.state = { sanghId: state._id, amount: 150 };
    details.country = { sanghId: country._id, amount: 150 };
    details.foundation = { amount: 300 }; // Foundation gets 300 for district-level sangh
  }

  else if (sangh.level === "state") {
    const country = await Sangh.findById(sangh.parentSangh);

    details.state = { sanghId: sangh._id, amount: 500 };
    details.country = { sanghId: country._id, amount: 200 };
    details.foundation = { amount: 400 }; // Foundation gets 400 for state-level sangh
  }

  return details;
};

module.exports = calculateDistribution;
