const badWords = require("./badWords");

const urlRegex = /(https?:\/\/[^\s]+)/gi;
const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi;
const numberRegex = /\b\d+\b/g;

exports.containsBadWords = (text = "") => {
  if (!text) return false;

  // 1️⃣ Remove URLs, emails, numbers
  let cleanText = text
    .replace(urlRegex, "")
    .replace(emailRegex, "")
    .replace(numberRegex, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0900-\u097F\s]/g, ""); // remove symbols, keep spaces for word split

  // 2️⃣ Split into words for exact matching
  const words = cleanText.split(/\s+/);

  return badWords.some(word => {
    const normalizedBad = word
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u0900-\u097F]/g, "");

    // 3️⃣ Check either exact word match OR phrase in text
    return words.includes(normalizedBad) || cleanText.includes(normalizedBad);
  });
};
