const axios = require("axios");

const sendVerificationSms = async (phoneNumber, otp, firstName) => {
  const API_KEY = process.env.SMSGATEWAY_APIKEY;
  const ENTITY_ID = process.env.DLT_ENTITY_ID;
  const TEMPLATE_ID = process.env.DLT_TEMPLATE_ID;
  const SENDER_ID = process.env.SMS_SENDER_ID;

  phoneNumber = phoneNumber.replace(/\D/g, '');

  if (!phoneNumber.startsWith('91')) {
    phoneNumber = '91' + phoneNumber.slice(-10);
  }

  const name = firstName && firstName.trim() ? firstName : "User";

  const message = `Dear ${name}, your OTP for verification is ${otp}. Please do not share it with anyone. Jain Prabuddh Manch Trust`;

  const url = "https://www.smsgatewayhub.com/api/mt/SendSMS";

  const params = {
    APIKey: API_KEY,
    senderid: SENDER_ID,
    channel: 2,
    DCS: 0,
    flashsms: 0,
    number: phoneNumber,
    text: message,
    route: 54,
    EntityId: ENTITY_ID,
    dlttemplateid: TEMPLATE_ID,
  };

  console.log("SMS Params:", params);

  const response = await axios.get(url, { params });
  return response.data;
};

module.exports = { sendVerificationSms };
