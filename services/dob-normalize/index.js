console.log("DOB NORMALIZE SERVICE STARTED");
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');
const cors = require('cors');
const { parse, format, isValid, subYears } = require('date-fns');

const chrono = require('chrono-node');

const app = express();



// --- Standalone, Testable Business Logic ---

// New Hybrid Function


async function normalizeDateOfBirth(rawDob) {
  console.log(`Normalizing DOB: ${rawDob}`);
  if (!rawDob || typeof rawDob !== 'string' || rawDob.trim().length === 0) {
    console.log("Returning null due to empty or invalid input.");
    return null;
  }

  try {
    const wordToNum = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
        'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90
    };

    let cleanedText = rawDob.toLowerCase().trim();
    
    // Replace ordinal indicators (st, nd, rd, th)
    cleanedText = cleanedText.replace(/(\d+)(st|nd|rd|th)/g, '$1');

    for (const word in wordToNum) {
        cleanedText = cleanedText.replace(new RegExp(`\\b${word}\\b`, 'g'), wordToNum[word]);
    }

    cleanedText = cleanedText.replace(/(\d{1,2}) (\d{1})/g, (match, p1, p2) => {
        if (parseInt(p1) >= 20 && parseInt(p2) < 10) {
            return parseInt(p1) + parseInt(p2);
        }
        return match;
    });

    cleanedText = cleanedText.replace(/(\d{2}) (\d{2})/g, (match, p1, p2) => {
        return p1 + p2;
    });

    // More robust date parsing using date-fns
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

    let parsedDate;
    for (const fmt of formats) {
      const date = parse(cleanedText, fmt, new Date());
      if (isValid(date)) {
        parsedDate = date;
        break;
      }
    }
    
    // Fallback to chrono-node for more complex cases
    if (!parsedDate) {
        const chronoResult = chrono.parseDate(cleanedText, new Date(), { forwardDate: false });
        if (chronoResult) {
            parsedDate = chronoResult;
        }
    }

    if (parsedDate && isValid(parsedDate)) {
      // Check if the year is plausible (e.g., not in the future and not more than 120 years ago)
      const currentYear = new Date().getFullYear();
      const year = parsedDate.getFullYear();
      if (year > currentYear || year < currentYear - 120) {
          console.log(`Parsed year ${year} is not plausible. Returning null.`);
          return null;
      }
      return format(parsedDate, 'yyyy-MM-dd');
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
