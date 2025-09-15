const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { parse, format, isValid, isFuture, isPast, addYears, subYears } = require('date-fns');
const { zonedTimeToUtc } = require('date-fns-tz');
const chrono = require('chrono-node');
const { wordsToNumbers } = require('words-to-numbers');

const app = express();

// --- Text Pre-processing ---
function preprocessText(text) {
  if (!text || typeof text !== 'string') return '';
  let cleanedText = text.toLowerCase();

  cleanedText = cleanedText.split(' ').map(word => {
      const num = wordsToNumbers(word, { fuzzy: true });
      return isNaN(num) ? word : num.toString();
  }).join(' ');

  const corrections = {
    'tomorow': 'tomorrow',
    'wendsday': 'wednesday',
    'thrusday': 'thursday',
    'febuary': 'february',
  };
  for (const [key, value] of Object.entries(corrections)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${key}\b`, 'g'), value);
  }
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
  console.log(`Cleaned text: "${text}" -> "${cleanedText}"`);
  return cleanedText;
}

// --- Validation ---
function validateDOB(date) {
    if (!isValid(date)) return false;
    const currentYear = new Date().getFullYear();
    const year = date.getFullYear();
    if (year > currentYear || year < currentYear - 120) {
        return false;
    }
    return true;
}

// --- Main Parsing Logic ---
async function normalizeDateOfBirth(rawDob) {
  console.log(`Normalizing DOB: ${rawDob}`);
  if (!rawDob || typeof rawDob !== 'string' || rawDob.trim().length === 0) {
    console.log("Returning null due to empty or invalid input.");
    return null;
  }

  try {
    const cleanedText = preprocessText(rawDob);

    // 1. Use chrono-node for robust natural language parsing, ensuring we don't parse dates in the future.
    let parsedDate = chrono.parseDate(cleanedText, new Date(), { forwardDate: false });

    // 2. If chrono fails, attempt parsing with date-fns using common formats.
    if (!parsedDate || !isValid(parsedDate)) {
        const formats = [
            'MMMM d yyyy',
            'd MMMM yyyy',
            'MM/dd/yyyy',
            'M/d/yyyy',
            'MM-dd-yyyy',
            'M-d-yyyy',
            'yyyy-MM-dd',
            'yyyy/MM/dd',
        ];
        for (const fmt of formats) {
            const date = parse(cleanedText, fmt, new Date());
            if (isValid(date)) {
                parsedDate = date;
                break;
            }
        }
    }

    if (parsedDate && validateDOB(parsedDate)) {
      const finalDate = format(parsedDate, 'yyyy-MM-dd');
      console.log(`Successfully parsed date: ${finalDate}`);
      return finalDate;
    }

    console.log("Failed to parse date with all methods. Returning null.");
    return null;
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
}

// --- Express App Setup ---
app.use(cors());
app.use(bodyParser.json());
app.post('/api/enhanced-dob-normalize', async (req, res) => {
  try {
    const { raw_dob } = req.body;
    if (!raw_dob) {
      return res.status(400).json({ error: 'Missing required field: raw_dob' });
    }
    const normalizedDate = await normalizeDateOfBirth(raw_dob);
    if (normalizedDate) {
      res.json({ dob_iso: normalizedDate, type: 'success' });
    } else {
      res.status(422).json({ dob_iso: null, type: 'unable_to_normalize' });
    }
  } catch (error) {
    console.error('Error in DOB endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Server Start Logic ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`DOB Normalization service running on port ${PORT}`);
});

// --- Exports for Testing ---
module.exports = app;
module.exports.normalizeDateOfBirth = normalizeDateOfBirth;
