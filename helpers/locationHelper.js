/**
 * locationHelper.js
 *
 * Backend location processing helper
 * Use this in your jainAdharController.js
 *
 * Import करो:
 * const { processLocation, validateLocation } = require("../../helpers/locationHelper");
 */

const { getCountryConfig } = require("../config/countryConfig");

/**
 * ✅ FUNCTION 1: processLocation
 *
 * Frontend से raw location data लो → actual field names में convert करो
 *
 * Input:
 *   India:   { state: "Maharashtra", district: "Mumbai", pinCode: "400050" }
 *   USA:     { state: "California", county: "Los Angeles", zip_code: "90001" }
 *   Canada:  { province: "Ontario", region: "Toronto", postal_code: "M5V 3L9" }
 *
 * Output:
 *   Exactly same - but validated और trimmed
 */
const processLocation = (rawLocation) => {
  if (!rawLocation) return null;

  const country = rawLocation.country || "India";
  const cfg = getCountryConfig(country);
  const location = { country };

  console.log(`\n[processLocation] ========== START ==========`);
  console.log(`[processLocation] Processing for: ${country}`);
  console.log(
    `[processLocation] rawLocation received:`,
    JSON.stringify(rawLocation, null, 2),
  );
  console.log(`[processLocation] Config fieldNames:`, {
    region1FieldName: cfg.region1FieldName,
    region2FieldName: cfg.region2FieldName,
    postalFieldName: cfg.postal?.fieldName,
  });

  if (country === "India") {
    // ✅ INDIA: पुरानी field names (backward compatible)
    location.state = rawLocation.state ? rawLocation.state.trim() : null;
    location.district = rawLocation.district
      ? rawLocation.district.trim()
      : null;
    location.pinCode = rawLocation.pinCode ? rawLocation.pinCode.trim() : null;

    console.log(`[processLocation] India location final:`, location);
  } else {
    // ✅ NON-INDIA: countryConfig से actual field names
    const field1Name = cfg.region1FieldName; // 'province', 'prefecture', 'state'
    const field2Name = cfg.region2FieldName; // 'county', 'region', 'district'
    const postalFieldName = cfg.postal?.fieldName || "postal";

    console.log(`[processLocation] Non-India processing...`);
    console.log(
      `[processLocation] Looking for field1Name: "${field1Name}" in rawLocation:`,
      !!rawLocation[field1Name],
      rawLocation[field1Name],
    );
    console.log(
      `[processLocation] Looking for field2Name: "${field2Name}" in rawLocation:`,
      !!rawLocation[field2Name],
      rawLocation[field2Name],
    );
    console.log(
      `[processLocation] Looking for postalFieldName: "${postalFieldName}" in rawLocation:`,
      !!rawLocation[postalFieldName],
      rawLocation[postalFieldName],
    );

    // Field1 (state/province/prefecture)
    if (rawLocation[field1Name]) {
      location[field1Name] = rawLocation[field1Name].trim();
      console.log(
        `[processLocation] ✅ Copied ${field1Name}: ${location[field1Name]}`,
      );
    } else {
      console.log(`[processLocation] ❌ MISSING ${field1Name}`);
    }

    // Field2 (district/county/region)
    if (rawLocation[field2Name]) {
      location[field2Name] = rawLocation[field2Name].trim();
      console.log(
        `[processLocation] ✅ Copied ${field2Name}: ${location[field2Name]}`,
      );
    } else {
      console.log(`[processLocation] ❌ MISSING ${field2Name}`);
    }

    // Postal
    if (rawLocation[postalFieldName]) {
      let postalValue = rawLocation[postalFieldName].trim();
      if (cfg.postal?.uppercase) {
        postalValue = postalValue.toUpperCase();
      }
      location[postalFieldName] = postalValue;
      console.log(
        `[processLocation] ✅ Copied ${postalFieldName}: ${location[postalFieldName]}`,
      );
    } else {
      console.log(`[processLocation] ❌ MISSING ${postalFieldName}`);
    }

    console.log(
      `[processLocation] ${country} location after processing:`,
      location,
    );
  }

  // Common fields
  location.city = rawLocation.city ? rawLocation.city.trim() : null;
  location.address = rawLocation.address ? rawLocation.address.trim() : null;

  console.log(`[processLocation] Final location object:`, location);
  console.log(`[processLocation] ========== END ==========\n`);

  return location;
};

/**
 * ✅ FUNCTION 2: validateLocation
 *
 * Location को country-aware तरीके से validate करो
 *
 * Returns:
 *   { valid: true }
 *   { valid: false, error: "State is required for India" }
 */
const validateLocation = (location) => {
  if (!location) {
    return { valid: false, error: "Location is required" };
  }

  const country = location.country || "India";
  const cfg = getCountryConfig(country);

  console.log(`[validateLocation] Validating for ${country}`);

  // ✅ Always required
  if (!location.city) {
    return { valid: false, error: "City is required" };
  }

  if (!location.address) {
    return { valid: false, error: "Address is required" };
  }

  // ✅ INDIA-specific validation
  if (country === "India") {
    if (!location.state) {
      return { valid: false, error: "State is required for India" };
    }

    if (!location.district) {
      return { valid: false, error: "District is required for India" };
    }

    if (!location.pinCode) {
      return { valid: false, error: "PIN Code is required for India" };
    }

    // PIN format validation
    if (!/^\d{6}$/.test(location.pinCode)) {
      return {
        valid: false,
        error: "Invalid PIN Code. Expected 6 digits (e.g., 400050)",
      };
    }

    console.log(`[validateLocation] India validation passed ✓`);
    return { valid: true };
  }

  // ✅ NON-INDIA: countryConfig के हिसाब से validation
  const field1Name = cfg.region1FieldName;
  const postalFieldName = cfg.postal?.fieldName || "postal";

  // Postal required है या नहीं?
  if (cfg.postal && cfg.postal.required && !location[postalFieldName]) {
    return {
      valid: false,
      error: `${cfg.postal.label} is required for ${country}`,
    };
  }

  // Postal format check
  if (location[postalFieldName] && cfg.postal && cfg.postal.regex) {
    if (!cfg.postal.regex.test(location[postalFieldName])) {
      return {
        valid: false,
        error: `Invalid ${cfg.postal.label}. Expected format: ${cfg.postal.placeholder}`,
      };
    }
  }

  console.log(`[validateLocation] ${country} validation passed ✓`);
  return { valid: true };
};

/**
 * ✅ FUNCTION 2b: processUserLocation
 *
 * User model ke liye location -- Aadhar form jaisa hi country-wise
 * field naming, lekin `address` aur postal (pinCode/zip_code/...) ke bina.
 * Null/khaali keys hata di jaati hain taaki $set purana data na mita de.
 *
 * Input : { country:"United States", state:"California", county:"Los Angeles",
 *           city:"Los Angeles", address:"...", zip_code:"90001" }
 * Output: { country:"United States", state:"California", county:"Los Angeles",
 *           city:"Los Angeles" }
 */
const processUserLocation = (rawLocation) => {
  const loc = processLocation(rawLocation);
  if (!loc) return null;

  const country = loc.country || "India";
  const cfg = getCountryConfig(country);

  const postalFieldName =
    country === "India" ? "pinCode" : cfg.postal?.fieldName || "postal";

  delete loc[postalFieldName];
  delete loc.address;

  Object.keys(loc).forEach((k) => {
    if (loc[k] === null || loc[k] === undefined || loc[k] === "") delete loc[k];
  });

  return loc;
};

/**
 * ✅ FUNCTION 2c: toMemberAddress
 *
 * Jain Aadhar ki location -> Sangh member/officeBearer wala address object.
 * address ke field names (street/city/district/state/pincode) waise hi rehte
 * hain -- sirf unme sahi country ki value bharti hai:
 *   India  -> state=state,     district=district, pincode=pinCode
 *   USA    -> state=state,     district=county,   pincode=zip_code
 *   Canada -> state=province,  district=region,   pincode=postal_code
 *   Japan  -> state=prefecture, district=(skip),  pincode=postal_code
 */
const toMemberAddress = (rawLocation) => {
  const loc = rawLocation || {};
  const country = loc.country || "India";
  const cfg = getCountryConfig(country);
  const isIndia = country === "India";

  const reserved = ["country", "city", "address"];
  const pick = (key) => (key && !reserved.includes(key) ? loc[key] || "" : "");

  const base = {
    country,
    street: loc.address || "",
    city: loc.city || "",
    state: isIndia ? loc.state || "" : pick(cfg.region1FieldName),
    district: isIndia ? loc.district || "" : pick(cfg.region2FieldName),
    pincode: isIndia ? loc.pinCode || "" : pick(cfg.postal?.fieldName),
  };

  if (isIndia) return base;

  // Non-India: standard slots ke saath country ke apne field names bhi rakho,
  // bilkul waise jaise Jain Shravak ki location me hote hain.
  //   Canada -> province, region, postal_code
  //   USA    -> state, county, zip_code
  //   Japan  -> prefecture, postal_code
  // Standard slots isliye bhare rehte hain kyunki member card, letterhead,
  // office bearer aur edit form sab address.state / district / pincode padhte
  // hain -- unhe todna nahi hai.
  const native = {};
  [cfg.region1FieldName, cfg.region2FieldName, cfg.postal?.fieldName].forEach(
    (key) => {
      const value = pick(key);
      if (value) native[key] = value;
    },
  );

  return { ...base, ...native };
};

/**
 * ✅ FUNCTION 3: getLocationFieldNames
 *
 * किसी country के लिए field names दो
 *
 * Usage:
 *   const fields = getLocationFieldNames("Canada");
 *   // { field1: "province", field2: "region", postal: "postal_code" }
 */
const getLocationFieldNames = (country) => {
  const cfg = getCountryConfig(country);
  return {
    country,
    field1: cfg.region1FieldName,
    field1Label: cfg.region1Label,
    field2: cfg.region2FieldName,
    field2Label: cfg.region2Label,
    postal: cfg.postal?.fieldName,
    postalLabel: cfg.postal?.label,
  };
};

/**
 * ✅ FUNCTION 4: normalizeLocationQuery
 *
 * Database query के लिए normalize करो
 *
 * Usage:
 *   const query = normalizeLocationQuery("Canada", "Ontario", "Toronto");
 *   // { "location.country": "Canada", "location.province": "Ontario" }
 */
const normalizeLocationQuery = (
  country,
  region1Value = null,
  region2Value = null,
) => {
  const cfg = getCountryConfig(country);
  const query = { "location.country": country };

  if (region1Value && cfg.region1FieldName) {
    query[`location.${cfg.region1FieldName}`] = {
      $regex: new RegExp(`^${region1Value}$`, "i"),
    };
  }

  if (region2Value && cfg.region2FieldName) {
    query[`location.${cfg.region2FieldName}`] = {
      $regex: new RegExp(`^${region2Value}$`, "i"),
    };
  }

  return query;
};

module.exports = {
  processLocation,
  processUserLocation,
  toMemberAddress,
  validateLocation,
  getLocationFieldNames,
  normalizeLocationQuery,
};

/**
 * USAGE EXAMPLES
 * ==============
 *
 * In jainAdharController.js:
 *
 * const { processLocation, validateLocation } = require("../../helpers/locationHelper");
 *
 * // In createJainAadhar function:
 * const createJainAadhar = asyncHandler(async (req, res) => {
 *   try {
 *     const { location } = req.body;
 *
 *     // ✅ Process location
 *     const processedLocation = processLocation(location);
 *
 *     // ✅ Validate location
 *     const validation = validateLocation(processedLocation);
 *     if (!validation.valid) {
 *       return errorResponse(res, validation.error, 400);
 *     }
 *
 *     // ✅ Create with processed location
 *     const jainAadharData = {
 *       userId: req.user._id,
 *       location: processedLocation,  // ← Uses actual field names!
 *       // ... other fields
 *     };
 *
 *     const jainAadhar = await JainAadhar.create(jainAadharData);
 *
 *     return successResponse(res, {
 *       message: "Jain Aadhar created successfully",
 *       data: jainAadhar
 *     }, 201);
 *   } catch (error) {
 *     console.error("Error:", error);
 *     return errorResponse(res, error.message, 500);
 *   }
 * });
 *
 *
 * DATABASE OUTPUT
 * ===============
 *
 * India:
 * {
 *   "location": {
 *     "country": "India",
 *     "state": "Maharashtra",
 *     "district": "Mumbai",
 *     "city": "Mumbai",
 *     "address": "123 MG Road",
 *     "pinCode": "400050"
 *   }
 * }
 *
 * USA:
 * {
 *   "location": {
 *     "country": "United States",
 *     "state": "California",
 *     "county": "Los Angeles",
 *     "city": "Los Angeles",
 *     "address": "123 Main St",
 *     "zip_code": "90001"
 *   }
 * }
 *
 * Canada:
 * {
 *   "location": {
 *     "country": "Canada",
 *     "province": "Ontario",
 *     "region": "Toronto",
 *     "city": "Toronto",
 *     "address": "123 King St",
 *     "postal_code": "M5V 3L9"
 *   }
 * }
 *
 * Japan:
 * {
 *   "location": {
 *     "country": "Japan",
 *     "prefecture": "Tokyo",
 *     "city": "Tokyo",
 *     "address": "123 Main St",
 *     "postal_code": "100-0001"
 *   }
 * }
 */
