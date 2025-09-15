console.log("DOB NORMALIZE SERVICE STARTED");
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');
const cors = require('cors');
const language = require('@google-cloud/language');

const app = express();
const languageClient = new language.LanguageServiceClient();

// --- Standalone, Testable Business Logic ---

// New Hybrid Function
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

function parseNumericDate(rawDob) {
    const cleaned = rawDob.replace(/[\s,]/g, ''); // Remove spaces and commas
    if (!/^\d+$/.test(cleaned)) {
        return null;
    }

    // List of possible formats, from most specific to least specific.
    const formats = [
        'MMDDYYYY',
        'MDDYYYY',
        'MMDYYYY',
        'MDYYYY',
        'MMDDYY',
        'MDDYY',
        'MMDYY',
        'MDYY'
    ];

    const date = moment(cleaned, formats, true); // Use strict parsing

    if (date.isValid()) {
        // If a 2-digit year was parsed and resulted in a future date, subtract 100 years.
        if (date.year() > moment().year()) {
            date.subtract(100, 'years');
        }
        return date.format('YYYY-MM-DD');
    }

    return null;
}


// Helper: Custom parser for specific patterns
function customSpokenDateParser(text) {
    const stringToNumber = (s) => {
        const wordToNum = {
            zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
            eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
            twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
        };
        const magnitude = { hundred: 100, thousand: 1000 };

        let total = 0;
        let currentNumber = 0;

        s.toLowerCase().split(/\s|-/).forEach(word => {
            if (wordToNum[word]) {
                currentNumber += wordToNum[word];
            } else if (magnitude[word]) {
                currentNumber *= magnitude[word];
                if (magnitude[word] === 1000) {
                    total += currentNumber;
                    currentNumber = 0;
                }
            } else if (!isNaN(parseInt(word))) {
                currentNumber += parseInt(word);
            }
        });
        total += currentNumber;
        return total;
    };

    let str = text.toLowerCase().replace(/,/g, '').replace(/\b(the|of)\b/g, '').replace(/\s+/g, ' ').trim();
    const dayMap = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, 'twenty-first': 21, 'twenty-second': 22, 'twenty-third': 23, 'twenty-fourth': 24, 'twenty-fifth': 25, 'twenty-sixth': 26, 'twenty-seventh': 27, 'twenty-eighth': 28, 'twenty-ninth': 29, 'thirtieth': 30, 'thirty-first': 31, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const monthMap = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

    for (const [word, num] of Object.entries(dayMap)) {
        str = str.replace(word, num);
    }

    const parts = str.split(' ');
    let day, month, year;

    if (monthMap[parts[0]]) {
        month = monthMap[parts[0]];
        const dayStr = parts[1];
        const yearStr = parts.slice(2).join(' ');

        day = parseInt(dayStr);
        year = stringToNumber(yearStr);

        if (!isNaN(day) && !isNaN(year)) {
            if (year < 100) year += 1900;
            const date = moment({ year, month: month - 1, day });
            if (date.isValid()) return date.format('YYYY-MM-DD');
        }
    }

    return null;
}

// Helper: The NL API parser from before
async function nlApiDateParser(rawDob) {
    const processedDob = rawDob.toLowerCase().replace(/(st|nd|rd|th),/g, '');
    const document = { content: processedDob, type: 'PLAIN_TEXT' };
    try {
        const [result] = await languageClient.analyzeEntities({ document });
        console.log(`NL API result: ${JSON.stringify(result)}`);
        const dateEntity = result.entities.find(e => e.type === 'DATE');
        console.log(`NL API date entity: ${JSON.stringify(dateEntity)}`);
        if (dateEntity && dateEntity.metadata && dateEntity.metadata.year && dateEntity.metadata.month && dateEntity.metadata.day) {
            const { year, month, day } = dateEntity.metadata;
            const parsedDate = moment({ year, month: month - 1, day });
            if (parsedDate.isValid() && parsedDate.year() >= 1900 && parsedDate.year() <= moment().year()) {
                return parsedDate.format('YYYY-MM-DD');
            }
        }
    } catch (error) {
        console.error(`NL API Error for '${rawDob}':`, error.details);
        return null;
    }
    return null;
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