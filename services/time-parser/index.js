const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');
const { zonedTimeToUtc, format } = require('date-fns-tz');
const { parse, isValid, isFuture, isPast, addYears, subYears } = require('date-fns');
const { wordsToNumbers } = require('words-to-numbers');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 8080;

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

  // Handle ordinal numbers (e.g., "18th" -> "18")
  cleanedText = cleanedText.replace(/(\d+)(st|nd|rd|th)/g, '$1');

  const numberWords = [
      'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
      'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand'
  ];

  cleanedText = cleanedText.split(' ').map(word => {
      if (numberWords.includes(word)) {
          const num = wordsToNumbers(word, { fuzzy: true });
          return isNaN(num) ? word : num.toString();
      }
      return word;
  }).join(' ');

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
    'anytimethisweek': 'anytime this week',
    'around 11': '11 am',
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

function validateDOB(date) {
    if (!isValid(date)) return false;
    const currentYear = new Date().getFullYear();
    const year = date.getFullYear();
    if (year > currentYear || year < currentYear - 120) {
        return false;
    }
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

async function parseWithChrono(text, referenceDate, forwardDate = true) {
  const results = chrono.parse(text, referenceDate, { forwardDate });
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

// --- Main Parsing Orchestrators ---
async function parseNaturalTime(naturalTime, timezone) {
  const cleanedTime = preprocessText(naturalTime);
  const referenceDate = zonedTimeToUtc(new Date(), timezone);

  let parsedResult = await parseWithStrictFormats(cleanedTime, referenceDate);
  if (parsedResult) return parsedResult;

  parsedResult = await parseWithChrono(cleanedTime, referenceDate);
  if (parsedResult) return parsedResult;

  return { date: null, confidence: 'none', method: 'none' };
}

async function normalizeDateOfBirth(rawDob) {
    const cleanedDob = preprocessText(rawDob);
    const referenceDate = new Date(); // DOBs are in the past

    let parsedResult = await parseWithChrono(cleanedDob, referenceDate, false);
    if (parsedResult && validateDOB(parsedResult.date)) {
        return parsedResult;
    }

    return { date: null, confidence: 'none', method: 'none' };
}


// --- Date Formatting ---
function addOrdinalSuffix(day) {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) {
    return day + 'st';
  }
  if (j === 2 && k !== 12) {
    return day + 'nd';
  }
  if (j === 3 && k !== 13) {
    return day + 'rd';
  }
  return day + 'th';
}

function formatAppointmentDateTime(date, time, timezone) {
  try {
    let appointmentMoment;
    if (time) {
      const dateTimeString = `${date} ${time}`;
      appointmentMoment = moment.tz(dateTimeString, [
        'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DD h:mm A',
        'YYYY-MM-DD h:mm:ss A',
        'YYYY-MM-DD hA',
        'YYYY-MM-DD h A',
        'MM/DD/YYYY HH:mm',
        'MM/DD/YYYY h:mm A',
        'MM/DD/YYYY hA',
        'MM-DD-YYYY HH:mm',
        'MM-DD-YYYY h:mm A',
        'MM-DD-YYYY hA'
      ], timezone);
    } else {
      appointmentMoment = moment.tz(date, [
        'YYYY-MM-DD',
        'MM/DD/YYYY',
        'MM-DD-YYYY',
        'YYYY/MM/DD',
        'DD/MM/YYYY',
        'DD-MM-YYYY'
      ], timezone);
    }

    if (!appointmentMoment.isValid()) {
      return {
        formatted_date: null,
        formatted_time: null,
        confirmation_text: 'Unable to parse the provided date',
        error: 'Invalid date format'
      };
    }

    const dayOfWeek = appointmentMoment.format('dddd');
    const month = appointmentMoment.format('MMMM');
    const day = appointmentMoment.date();
    const dayWithOrdinal = addOrdinalSuffix(day);
    const year = appointmentMoment.year();
    
    const currentYear = moment().year();
    const formatted_date = year === currentYear 
      ? `${dayOfWeek}, ${month} ${dayWithOrdinal}`
      : `${dayOfWeek}, ${month} ${dayWithOrdinal}, ${year}`;

    let formatted_time = null;
    if (time || appointmentMoment.hour() !== 0 || appointmentMoment.minute() !== 0) {
      const hour = appointmentMoment.hour();
      const minute = appointmentMoment.minute();
      
      if (minute === 0) {
        formatted_time = appointmentMoment.format('hA');
      } else {
        formatted_time = appointmentMoment.format('h:mm A');
      }
    }

    let confirmation_text;
    if (formatted_time) {
      confirmation_text = `Your appointment is scheduled for ${formatted_date} at ${formatted_time}`;
    } else {
      confirmation_text = `Your appointment is scheduled for ${formatted_date}`;
    }

    if (timezone !== 'America/New_York') {
      const tzAbbr = appointmentMoment.format('z');
      confirmation_text += ` (${tzAbbr})`;
    }

    return {
      formatted_date,
      formatted_time,
      confirmation_text
    };

  } catch (error) {
    console.error('Error in formatAppointmentDateTime:', error);
    return {
      formatted_date: null,
      formatted_time: null,
      confirmation_text: 'Error formatting date',
      error: error.message
    };
  }
}

// --- API Endpoints ---
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

app.post('/api/normalize-dob', async (req, res) => {
    try {
        const { raw_dob } = req.body.data || {};
        if (!raw_dob) {
            return res.status(400).json({ success: false, message: 'Missing required field: data.raw_dob' });
        }

        const result = await normalizeDateOfBirth(raw_dob);

        if (result.date) {
            res.json({
                success: true,
                message: 'Successfully normalized date of birth.',
                dob_iso: format(result.date, 'yyyy-MM-dd'),
            });
        } else {
            res.status(422).json({
                success: false,
                message: `Could not confidently normalize the date of birth from input: "${raw_dob}"`, 
            });
        }
    } catch (error) {
        console.error('Error normalizing DOB:', error);
        res.status(500).json({ success: false, message: 'Internal server error during DOB normalization.' });
    }
});

app.post('/api/format-appointment-date', (req, res) => {
  try {
    const { date, time, timezone } = req.body;
    if (!date) {
      return res.status(400).json({
        error: 'Missing required field: date',
        formatted_date: null,
        formatted_time: null,
        confirmation_text: null
      });
    }
    const tz = timezone || 'America/New_York';
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        error: `Invalid timezone: ${timezone}. Please use a valid IANA timezone identifier.`, 
        formatted_date: null,
        formatted_time: null,
        confirmation_text: null
      });
    }
    const formattedData = formatAppointmentDateTime(date, time, tz);
    res.json(formattedData);
  } catch (error) {
    console.error('Error formatting appointment date:', error);
    res.status(500).json({
      error: 'Internal server error',
      formatted_date: null,
      formatted_time: null,
      confirmation_text: null
    });
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Time Parser and Formatter service running on port ${PORT}`);
});

module.exports = app;