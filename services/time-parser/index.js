const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// --- Start of New Pre-processing Logic ---

/**
 * Pre-processes a raw natural language string to make it more parsable.
 * - Converts to lowercase
 * - Fixes common speech-to-text concatenation errors
 * - Corrects common typos
 * - Normalizes synonyms
 * @param {string} text - The raw input string.
 * @returns {string} - The cleaned string.
 */
function preprocessNaturalTime(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleanedText = text.toLowerCase();

  // 1. Fix common concatenations (e.g., "anytimethisweek" -> "anytime this week")
  const keywords = [
    'anytime', 'any', 'day', 'time', 'this', 'next', 'last', 'week', 'month', 'year',
    'morning', 'afternoon', 'evening', 'night',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'today', 'tomorrow', 'yesterday'
  ];
  // This regex finds keywords that are stuck together and adds a space
  keywords.forEach(keyword => {
    const regex = new RegExp(`(${keyword})(?=[a-z])`, 'g');
    cleanedText = cleanedText.replace(regex, '$1 ');
  });
  // Specific fix for "any time"
  cleanedText = cleanedText.replace(/anytime/g, 'any time');


  // 2. Correct common typos
  const typoMap = {
    'tomorow': 'tomorrow',
    'wendsday': 'wednesday',
    'thrusday': 'thursday',
    'febuary': 'february'
  };
  for (const [typo, correct] of Object.entries(typoMap)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${typo}\b`, 'g'), correct);
  }

  // 3. Normalize synonyms
  const synonymMap = {
    'noon': '12:00pm',
    'midday': '12:00pm',
    'midnight': '12:00am',
    'end of the week': 'friday',
    'eod': '5:00pm'
  };
  for (const [synonym, standard] of Object.entries(synonymMap)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${synonym}\b`, 'g'), standard);
  }
  
  // Remove extra spaces
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

  console.log(`Cleaned text: "${text}" -> "${cleanedText}"`);
  return cleanedText;
}

// --- End of New Pre-processing Logic ---


// Main natural language time parser endpoint
app.post('/api/enhanced-parse-natural-time', (req, res) => {
  try {
    const { natural_time, timezone } = req.body;

    if (!natural_time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: natural_time',
        parsed: null
      });
    }

    const tz = timezone || 'America/New_York';

    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        success: false,
        message: `Invalid timezone: ${timezone}. Please use a valid IANA timezone identifier.`,
        parsed: null
      });
    }

    // ** USE THE NEW PRE-PROCESSING FUNCTION **
    const cleaned_natural_time = preprocessNaturalTime(natural_time);
    
    const parsedResult = parseNaturalTime(cleaned_natural_time, tz);

    if (parsedResult.date) {
      res.json({
        success: true,
        message: 'Successfully parsed date/time.',
        parsed: parsedResult
      });
    } else {
      res.status(200).json({ // Return 200 OK but with success: false as the call itself was valid
        success: false,
        message: `Could not confidently parse the date/time from input: "${natural_time}"`,
        parsed: parsedResult
      });
    }

  } catch (error) {
    console.error('Error parsing natural time:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during parsing.',
      parsed: null
    });
  }
});

/**
 * Parse natural language time using chrono-node
 * @param {string} naturalTime - The pre-processed natural language time string
 * @param {string} timezone - The timezone to use for parsing
 * @returns {object} - Parsed date, time of day, and confidence
 */
function parseNaturalTime(naturalTime, timezone) {
  try {
    const referenceDate = moment.tz(timezone).toDate();
    
    const results = chrono.parse(naturalTime, referenceDate, { 
      forwardDate: true
    });

    if (!results || results.length === 0) {
        return {
          date: null,
          time_of_day: 'any',
          confidence: 'low'
        };
    }

    const result = results[0];
    
    if (!result || !result.start) {
      return {
        date: null,
        time_of_day: 'any',
        confidence: 'low'
      };
    }

    const parsedDate = result.start.date();
    const dateInTimezone = moment.tz(parsedDate, timezone);
    const formattedDate = dateInTimezone.format('YYYY-MM-DD');
    
    const timeOfDay = determineTimeOfDay(result, naturalTime);
    const confidence = determineConfidence(result, naturalTime);

    return {
      date: formattedDate,
      time_of_day: timeOfDay,
      confidence: confidence
    };

  } catch (error) {
    console.error('Error in parseNaturalTime:', error);
    return {
      date: null,
      time_of_day: 'any',
      confidence: 'low'
    };
  }
}

/**
 * Determine the time of day from the parsed result and original text
 * @param {object} result - Chrono parse result
 * @param {string} originalText - Original natural language text
 * @returns {string} - Time of day (morning/afternoon/evening/any)
 */
function determineTimeOfDay(result, originalText) {
  const lowerText = originalText.toLowerCase();
  
  if (lowerText.includes('morning') || lowerText.includes('am')) {
    return 'morning';
  }
  if (lowerText.includes('afternoon') || (lowerText.includes('pm') && !lowerText.includes('evening'))) {
    return 'afternoon';
  }
  if (lowerText.includes('evening') || lowerText.includes('night') || lowerText.includes('tonight')) {
    return 'evening';
  }
  
  if (result.start.get('hour') !== undefined) {
    const hour = result.start.get('hour');
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 24) return 'evening';
  }
  
  return 'any';
}

/**
 * Determine the confidence level of the parse
 * @param {object} result - Chrono parse result
 * @param {string} originalText - Original natural language text
 * @returns {string} - Confidence level (high/medium/low)
 */
function determineConfidence(result, originalText) {
  const lowerText = originalText.toLowerCase();

  if (result.start.get('year') !== undefined && 
      result.start.get('month') !== undefined && 
      result.start.get('day') !== undefined) {
    return 'high';
  }
  
  const highConfidenceKeywords = [
    'today', 'tomorrow', 'yesterday',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  if (highConfidenceKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'high';
  }
  
  const mediumConfidenceKeywords = [
    'next', 'this', 'last', 'week', 'month', 'year',
    'morning', 'afternoon', 'evening', 'night'
  ];
  
  if (mediumConfidenceKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'medium';
  }
  
  return 'low';
}

// Start the server
app.listen(PORT, () => {
  console.log(`Natural Language Time Parser service running on port ${PORT}`);
  console.log(`Main endpoint: http://localhost:${PORT}/api/enhanced-parse-natural-time`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;