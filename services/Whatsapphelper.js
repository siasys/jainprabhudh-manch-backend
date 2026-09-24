const axios = require("axios");
const FormData = require("form-data");

const sendVerificationWhatsApp = async (
  phoneNumber,
  otp,
  firstName,
  country = "India",
) => {
  try {
    // Environment variables से credentials लो
    const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
    const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
    const WHATSAPP_TENANT_SUBDOMAIN = process.env.WHATSAPP_TENANT_SUBDOMAIN;
    const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "otp";
    const WHATSAPP_TEMPLATE_LANGUAGE =
      process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";

    // Validation
    if (
      !WHATSAPP_API_URL ||
      !WHATSAPP_API_TOKEN ||
      !WHATSAPP_TENANT_SUBDOMAIN
    ) {
      console.error("❌ WhatsApp API credentials missing in .env");
      return {
        statusCode: 1,
        message:
          "WhatsApp service temporarily unavailable. Please try Email instead.",
        success: false,
      };
    }

    // ✅ Country Code Mapping
    const countryCodes = {
      India: "91",
      "United States": "1",
      "United Kingdom": "44",
      Canada: "1",
      Australia: "61",
      "United Arab Emirates": "971",
      Germany: "49",
      France: "33",
      Japan: "81",
      Singapore: "65",
      "Hong Kong": "852",
      Malaysia: "60",
      Thailand: "66",
      Indonesia: "62",
      Philippines: "63",
      Pakistan: "92",
      Bangladesh: "880",
      "Sri Lanka": "94",
      Nepal: "977",
      "South Korea": "82",
      Mexico: "52",
      Brazil: "55",
    };

    // ✅ Get country code from mapping
    const countryCode = countryCodes[country] || "91"; // Default to India

    // Phone number को format करो (सही country code के साथ)
    let formattedPhone = phoneNumber.replace(/\D/g, "");

    // Remove country code if already present
    if (formattedPhone.startsWith(countryCode)) {
      formattedPhone = formattedPhone.slice(countryCode.length);
    }

    // Add correct country code
    formattedPhone = countryCode + formattedPhone.slice(-10);
    formattedPhone = "+" + formattedPhone;

    console.log(
      `[WhatsApp] Country: ${country}, Code: +${countryCode}, Formatted: ${formattedPhone}`,
    );

    // API URL बनाओ
    const url = `${WHATSAPP_API_URL}/${WHATSAPP_TENANT_SUBDOMAIN}/messages/template`;

    // ✅ Form Data (Sparklebot API documentation के अनुसार)
    const formData = new FormData();
    formData.append("phone_number", formattedPhone);
    formData.append("template_name", WHATSAPP_TEMPLATE_NAME);
    formData.append("template_language", WHATSAPP_TEMPLATE_LANGUAGE);
    formData.append("field_1", otp); // {{1}} के लिए OTP

    console.log("[WhatsApp] Sending OTP with Form Data:", {
      url,
      phone: formattedPhone,
      template: WHATSAPP_TEMPLATE_NAME,
      language: WHATSAPP_TEMPLATE_LANGUAGE,
      field_1: otp,
    });

    // API Call करो
    const response = await axios.post(url, formData, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
        ...formData.getHeaders(), // ✅ Form Data headers
      },
      timeout: 10000, // 10 second timeout
    });

    console.log("[WhatsApp] Response Status:", response.status);
    console.log("[WhatsApp] Response Data:", response.data);

    // Sparklebot API के response को check करो
    if (response.status === 200 || response.status === 201) {
      return {
        statusCode: 0,
        message: "WhatsApp OTP sent successfully",
        success: true,
        data: response.data,
      };
    } else {
      return {
        statusCode: response.status,
        message: response.data?.message || "Failed to send WhatsApp OTP",
        success: false,
        data: response.data,
      };
    }
  } catch (error) {
    console.error("[WhatsApp] Error:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    // Detailed error handling
    if (error.response?.status === 401) {
      return {
        statusCode: 401,
        message: "WhatsApp API authentication failed. Invalid credentials.",
        success: false,
      };
    }

    if (error.response?.status === 400 || error.response?.status === 500) {
      return {
        statusCode: error.response.status,
        message:
          error.response?.data?.message ||
          "Invalid WhatsApp request. Check template and parameters.",
        success: false,
      };
    }

    if (error.code === "ECONNABORTED") {
      return {
        statusCode: 504,
        message: "WhatsApp service timeout. Please try again.",
        success: false,
      };
    }

    return {
      statusCode: error.response?.status || 500,
      message:
        error.response?.data?.message ||
        "Failed to send WhatsApp OTP. Please use Email instead.",
      success: false,
      error: error.message,
    };
  }
};

module.exports = { sendVerificationWhatsApp };
