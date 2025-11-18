const badWords = require("./badWords");

exports.containsBadWords = (text = "") => {
  if (!text) return false;

  // Normalize & clean text (Hindi + English)
  let cleanText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0900-\u097F]/g, ""); // remove *, . , !

  // ---- EXTRA STRONG CLEANING (for f**k = fuk) ----
  let superCleanText = cleanText.replace(/[aeiou]/g, ""); // remove vowels -> fuck = fck , fu*k = fk

  return badWords.some(word => {
    let bad = word
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u0900-\u097F]/g, "");

    let badNoVowels = bad.replace(/[aeiou]/g, "");

    // 1️⃣ SIMPLE MATCH  
    if (cleanText.includes(bad)) return true;

    // 2️⃣ MATCH WITHOUT VOWELS (fuk, fck, fk)
    if (superCleanText.includes(badNoVowels)) return true;

    return false;
  });
};
