const express = require('express');
const validator = require('email-validator');
const { LanguageServiceClient } = require('@google-cloud/language');

const app = express();
const languageClient = new LanguageServiceClient();

app.use(express.json());

// Dictionary for common domain misspellings
const domainCorrections = {
  // Gmail
  'gmaildotcom': 'gmail.com', 'gmaildotco': 'gmail.com', 'gmaildot': 'gmail.com', 'gmailcom': 'gmail.com',
  'gaildotcom': 'gmail.com', 'gaildotco': 'gmail.com', 'gaildot': 'gmail.com', 'gailcom': 'gmail.com',
  'ghaildotcom': 'gmail.com', 'ghaildotco': 'gmail.com', 'ghaildot': 'gmail.com', 'ghailcom': 'gmail.com',
  // Yahoo
  'yahoodotcom': 'yahoo.com', 'yahoodotco': 'yahoo.com', 'yahoodot': 'yahoo.com', 'yahoocom': 'yahoo.com',
  'yahodotcom': 'yahoo.com', 'yahodotco': 'yahoo.com', 'yahodot': 'yahoo.com', 'yahocom': 'yahoo.com',
  // Outlook / Hotmail / Live
  'outlookdotcom': 'outlook.com', 'outlookdotco': 'outlook.com', 'outlookdot': 'outlook.com', 'outlookcom': 'outlook.com',
  'hotmaildotcom': 'hotmail.com', 'hotmaledotcom': 'hotmail.com', 'hotmalecom': 'hotmail.com',
  'livedotcom': 'live.com', 'livedotco': 'live.com', 'livedot': 'live.com', 'livecom': 'live.com',
  // iCloud
  'iclouddotcom': 'icloud.com', 'iclouddotco': 'icloud.com', 'iclouddot': 'icloud.com', 'icloudcom': 'icloud.com',
  // Other
  'aolcom': 'aol.com',
  'protonmaildotcom': 'protonmail.com',
  'yandexdotcom': 'yandex.com',
  'maildotcom': 'mail.com',
  'examplecom': 'example.com'
};

const tldCorrections = {
  'comm': 'com',
  'co': 'com',
  'nt': 'net',
  'og': 'org'
};

function manualClean(emailString) {
  let cleaned = emailString.toLowerCase();
  cleaned = cleaned.replace(/\s/g, ''); // Remove all spaces
  cleaned = cleaned.replace(/attherateof/g, '@');
  cleaned = cleaned.replace(/at/g, '@');

  // Apply domain corrections before replacing 'dot'
  let [localPart, domainPart] = cleaned.split('@');
  if (domainCorrections[domainPart]) {
    cleaned = `${localPart}@${domainCorrections[domainPart]}`;
  }

  cleaned = cleaned.replace(/dot/g, '.');

  // TLD correction
  [localPart, domainPart] = cleaned.split('@');
  if (domainPart) {
    const domainParts = domainPart.split('.');
    const tld = domainParts[domainParts.length - 1];
    if (tldCorrections[tld]) {
      domainParts[domainParts.length - 1] = tldCorrections[tld];
      cleaned = `${localPart}@${domainParts.join('.')}`;
    }
  }

  // Final cleanup for repeated characters
  cleaned = cleaned.replace(/@@/g, '@'); // Remove double @
  cleaned = cleaned.replace(/\.\./g, '.'); // Remove double dots

  return cleaned;
}

async function cleanEmail(rawEmail) {
  // 1. Prioritize Google NL API for robust parsing
  try {
    const document = {
      content: rawEmail,
      type: 'PLAIN_TEXT',
    };
    const [result] = await languageClient.analyzeEntities({ document });
    const emailEntity = result.entities.find(e => e.type === 'EMAIL');

    if (emailEntity?.name) {
      // If NL API finds a potential email, clean it.
      const cleanedFromEntity = manualClean(emailEntity.name);
      if (validator.validate(cleanedFromEntity)) {
        return cleanedFromEntity;
      }
    }
  } catch (error) {
    console.error('Error calling Natural Language API:', error);
    // Fallback to manual cleaning if API fails
  }

  // 2. Fallback to manual cleaning for common spoken patterns
  return manualClean(rawEmail);
}

app.post('/', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Missing required field: email' });
  }

  const cleanedEmail = await cleanEmail(email);
  const isValid = validator.validate(cleanedEmail);

  res.json({
    original_email: email,
    cleaned_email: cleanedEmail,
    is_valid: isValid,
  });
});

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = { cleanEmail, app };
