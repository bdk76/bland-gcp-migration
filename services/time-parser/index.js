const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');
const { zonedTimeToUtc, format } = require('date-fns-tz');
const { parse, isValid, isFuture, isPast, addYears, subYears } = require('date-fns');
const { wordsToNumbers } = require('words-to-numbers');
const Fuse = require('fuse.js');
const { LanguageServiceClient } = require('@google-cloud/language');

const app = express();
const PORT = process.env.PORT || 8080;
const languageClient = new LanguageServiceClient();

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// --- Text Pre-processing ---
function preprocessText(text) {
  if (!text || typeof text !== 'string') return '';
  let cleanedText = text.toLowerCase();
  cleanedText = wordsToNumbers(cleanedText, { fuzzy: true });
  const corrections = {
    'tomorow': 'tomorrow',
    'wendsday': 'wednesday',
    'thrusday': 'thursday',
    'febuary': 'february',
    'noon': '12:00pm',
    'midday': '12:00pm',
    'midnight': '12:00am',
    'end of the week': 'friday',
    'eod': '5:00pm',
    'as soon as possible': 'today',
    'assoonaspossible': 'today',
    'anytimenextweek': 'anytime next week',
    'tomorrowanytime': 'tomorrow anytime',
  };
  for (const [key, value] of Object.entries(corrections)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${key}\b`, 'g'), value);
  }
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
  console.log(`Cleaned text: "${text}" -> "${cleanedText}"`);
  return cleanedText;
}

// --- Validation ---
function validateParsedDate(date) {
  if (!isValid(date)) return false;
  if (isFuture(date) && date > addYears(new Date(), 2)) return false;
  if (isPast(date) && date < subYears(new Date(), 1)) return false;
  return true;
}

// --- Parsing Layers ---
async function parseWithStrictFormats(text, referenceDate) {
  const formats = ['MM/dd/yyyy', 'yyyy-MM-dd', 'M/d/yy', 'M/d/yyyy'];
  for (const fmt of formats) {
    const parsedDate = parse(text, fmt, referenceDate);
    if (validateParsedDate(parsedDate)) {
      return { date: parsedDate, confidence: 'high', method: 'strict' };
    }
  }
  return null;
}

async function parseWithChrono(text, referenceDate) {
  const results = chrono.parse(text, referenceDate);
  if (!results || results.length === 0) return null;
  const result = results[0];
  if (result && result.start) {
    const parsedDate = result.start.date();
    if (validateParsedDate(parsedDate)) {
      const confidence = result.start.isCertain('year') && result.start.isCertain('month') && result.start.isCertain('day') ? 'high' : 'medium';
      return { date: parsedDate, confidence, method: 'chrono' };
    }
  }
  return null;
}

// --- Main Parsing Orchestrator ---
async function parseNaturalTime(naturalTime, timezone) {
  const cleanedTime = preprocessText(naturalTime);
  const referenceDate = zonedTimeToUtc(new Date(), timezone);

  // Layer 1: Strict Formats
  let parsedResult = await parseWithStrictFormats(cleanedTime, referenceDate);
  if (parsedResult) return parsedResult;

  // Layer 2: Chrono
  parsedResult = await parseWithChrono(cleanedTime, referenceDate);
  if (parsedResult) return parsedResult;

  return { date: null, confidence: 'none', method: 'none' };
}

// --- API Endpoint ---
app.post('/api/enhanced-parse-natural-time', async (req, res) => {
  try {
    const { datetime_request, timezone } = req.body.data || {};
    if (!datetime_request) {
      return res.status(400).json({ success: false, message: 'Missing required field: data.datetime_request' });
    }
    const tz = timezone || 'America/New_York';
    try {
      zonedTimeToUtc(new Date(), tz);
    } catch (e) {
      return res.status(400).json({ success: false, message: `Invalid timezone: ${tz}` });
    }

    const result = await parseNaturalTime(datetime_request, tz);

    if (result.date) {
      res.json({
        success: true,
        message: `Successfully parsed date/time using ${result.method} method.`, 
        parsed: {
          date: format(result.date, 'yyyy-MM-dd', { timeZone: tz }),
          confidence: result.confidence,
        },
      });
    } else {
      res.status(422).json({
        success: false,
        message: `Could not confidently parse the date/time from input: "${datetime_request}"`, 
      });
    }
  } catch (error) {
    console.error('Error parsing natural time:', error);
    res.status(500).json({ success: false, message: 'Internal server error during parsing.' });
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Natural Language Time Parser service running on port ${PORT}`);
});

module.exports = app;