const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const mjml = require("mjml");

const renderEmailTemplate = (templateName, data) => {
  const filePath = path.join(
    __dirname,
    "../emailTemplates",
    `${templateName}.mjml`,
  );
  const mjmlContent = fs.readFileSync(filePath, "utf-8");

  // ✅ Pehle Handlebars — variables inject karo MJML mein
  const template = Handlebars.compile(mjmlContent);
  const mjmlWithData = template(data);

  // ✅ Phir MJML compile karo HTML mein
  const mjmlOutput = mjml(mjmlWithData);

  return mjmlOutput.html;
};

module.exports = { renderEmailTemplate };
