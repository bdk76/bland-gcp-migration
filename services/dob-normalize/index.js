console.log("DOB NORMALIZE SERVICE STARTED");
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { parse, format, isValid } = require('date-fns');
const chrono = require('chrono-node');
const { wordToNumbers } = require('word-to-numbers');

const app = express();

// --- Standalone, Testable Business Logic ---

async function normalizeDateOfBirth(rawDob) {
  console.log(`Normalizing DOB: ${rawDob}`);
  if (!rawDob || typeof rawDob !== 'string' || rawDob.trim().length === 0) {
    console.log("Returning null due to empty or invalid input.");
    return null;
  }

  try {
    // 1. Convert all number words and ordinals to digits.
    const cleanedText = wordToNumbers(rawDob, { fuzzy: true });
    console.log(`Cleaned text after word-to-numbers: ${cleanedText}`);

    // 2. Use chrono-node for robust natural language parsing.
    let parsedDate = chrono.parseDate(cleanedText, new Date(), { forwardDate: false });

    // 3. If chrono fails, attempt parsing with date-fns using common formats.
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

    if (parsedDate && isValid(parsedDate)) {
      // 4. Validate the parsed year for plausibility.
      const currentYear = new Date().getFullYear();
      const year = parsedDate.getFullYear();
      if (year > currentYear || year < currentYear - 120) {
          console.log(`Parsed year ${year} is not plausible. Returning null.`);
          return null;
      }
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

// --- Express App Setup (Transport Layer) ---
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
      res.json({ dob_iso: null, type: 'unable_to_normalize' });
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