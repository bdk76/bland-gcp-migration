const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');
const moment = require('moment-timezone');
const { LanguageServiceClient } = require('@google-cloud/language');

const app = express();
const PORT = process.env.PORT || 8080;
const languageClient = new LanguageServiceClient();

// Middleware - These are like the basic tools your server needs
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint - Like checking if the receptionist desk is open
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ====================
// GOOGLE NLP INTEGRATION
// ====================
// This is like having a grammar checker before processing
async function analyzeAndCorrectText(text) {
  try {
    const document = {
      content: text,
      type: 'PLAIN_TEXT',
    };
    const [result] = await languageClient.analyzeSyntax({ document });
    const tokens = result.tokens;
    const correctedText = tokens.map(token => token.text.content).join(' ');
    console.log(`Original text: "${text}" -> Corrected text: "${correctedText}"`);
    return correctedText;
  } catch (error) {
    console.error('Error calling Natural Language API:', error);
    // If Google NLP fails, continue with original text
    return text;
  }
}

// ====================
// NUMBER CONVERSION SYSTEM
// ====================
/**
 * Converts spoken numbers to digits - like a translator for number words
 * Examples: 
 * - "four fifteen ninety four" -> "4/15/94"
 * - "twenty three" -> "23"
 */
function convertSpokenNumbersToDigits(text) {
  // Our number dictionary - maps words to their digit equivalents
  const numberWords = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
    'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
    'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
    'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
    'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
    'eighty': '80', 'ninety': '90'
  };

  let processedText = text;
  
  // Handle compound numbers like "twenty one" -> "21"
  processedText = processedText.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(one|two|three|four|five|six|seven|eight|nine)\b/gi, 
    (match, tens, ones) => {
      const tensDigit = numberWords[tens.toLowerCase()];
      const onesDigit = numberWords[ones.toLowerCase()];
      return String(parseInt(tensDigit) + parseInt(onesDigit));
    }
  );

  // Look for date patterns (like when someone says "four fifteen ninety four" for 4/15/94)
  const datePattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|twenty[\s-]?one|twenty[\s-]?two|twenty[\s-]?three|twenty[\s-]?four|twenty[\s-]?five|twenty[\s-]?six|twenty[\s-]?seven|twenty[\s-]?eight|twenty[\s-]?nine|thirty[\s-]?one)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[\s-]?one|twenty[\s-]?two|twenty[\s-]?three|twenty[\s-]?four|twenty[\s-]?five|twenty[\s-]?six|twenty[\s-]?seven|twenty[\s-]?eight|twenty[\s-]?nine|thirty|thirty[\s-]?one)\s+(ninety|nineteen|twenty|twenty[\s-]?one|twenty[\s-]?two|twenty[\s-]?three|twenty[\s-]?four|twenty[\s-]?five|twenty[\s-]?six|twenty[\s-]?seven|twenty[\s-]?eight|twenty[\s-]?nine|thirty|thirty[\s-]?one)[ -]?(one|two|three|four|five|six|seven|eight|nine)?\b/gi; // Corrected   and - for space and hyphen
  
  processedText = processedText.replace(datePattern, (match) => {
    const parts = match.split(/\s+/);
    const converted = parts.map(part => {
      if (/^\d+$/.test(part)) return part;
      const lower = part.toLowerCase();
      return numberWords[lower] || part;
    });
    
    // Format as MM/DD/YY or MM/DD/YYYY
    if (converted.length >= 3 && converted.every(p => /^\d+$/.test(p))) {
      const month = converted[0];
      const day = converted[1];
      let year = converted.slice(2).join('');
      
      // Assume 1900s for years > 30, 2000s for years <= 30
      if (year.length === 2) {
        year = parseInt(year) > 30 ? '19' + year : '20' + year;
      }
      
      return `${month}/${day}/${year}`;
    }
    return match;
  });

  // Replace any remaining standalone number words
  for (const [word, digit] of Object.entries(numberWords)) {
    const regex = new RegExp(`\b${word}\b`, 'gi');
    processedText = processedText.replace(regex, digit);
  }

  console.log(`Number conversion: "${text}" -> "${processedText}"`);
  return processedText;
}

// ====================
// WORD SEPARATION SYSTEM
// ====================
/**
 * Separates words that got stuck together - like adding spaces to "anytimethisweek"
 */
function enhancedWordSeparation(text) {
  let separated = text;
  
  // All the keywords we want to separate
  const timeKeywords = [
    'anytime', 'any', 'time', 'day', 'this', 'next', 'last', 
    'week', 'month', 'year', 'morning', 'afternoon', 'evening', 
    'night', 'today', 'tomorrow', 'yesterday'
  ];
  
  const dayNames = [
    'monday', 'tuesday', 'wednesday', 'thursday', 
    'friday', 'saturday', 'sunday'
  ];
  
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june', 
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  // Sort by length (longest first) to avoid partial matches
  const allKeywords = [...timeKeywords, ...dayNames, ...monthNames]
    .sort((a, b) => b.length - a.length);
  
  // Smart separation - look for keywords stuck together
  allKeywords.forEach(keyword => {
    // Check if keyword has letters stuck after it
    const pattern = new RegExp(`(${keyword})([a-z]+)`, 'gi');
    separated = separated.replace(pattern, '$1 $2');
    
    // Check if keyword has letters stuck before it
    const beforePattern = new RegExp(`([a-z]+)(${keyword})`, 'gi');
    separated = separated.replace(beforePattern, '$1 $2');
  });
  
  // Special case: "anytime" should be "any time"
  separated = separated.replace(/\banytime\b/gi, 'any time');
  
  return separated;
}

// ====================
// MAIN PREPROCESSING FUNCTION
// ====================
/**
 * The main text cleaner - runs all preprocessing steps in order
 */
function preprocessNaturalTime(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleanedText = text.toLowerCase();
  
  // Step 1: Convert spoken numbers to digits
  cleanedText = convertSpokenNumbersToDigits(cleanedText);
  
  // Step 2: Separate stuck-together words
  cleanedText = enhancedWordSeparation(cleanedText);
  
  // Step 3: Fix common typos
  const typoMap = {
    'tomorow': 'tomorrow',
    'tommorow': 'tomorrow',
    'wendsday': 'wednesday',
    'wensday': 'wednesday',
    'thrusday': 'thursday',
    'febuary': 'february',
    'janurary': 'january'
  };
  for (const [typo, correct] of Object.entries(typoMap)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${typo}\b`, 'g'), correct);
  }
  
  // Step 4: Normalize common synonyms
  const synonymMap = {
    'noon': '12:00pm',
    'midday': '12:00pm',
    'midnight': '12:00am',
    'end of the week': 'friday',
    'eod': '5:00pm',
    'end of day': '5:00pm'
  };
  for (const [synonym, standard] of Object.entries(synonymMap)) {
    cleanedText = cleanedText.replace(new RegExp(`\b${synonym}\b`, 'g'), standard);
  }
  
  // Step 5: Clean up extra spaces
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
  
  console.log(`Full preprocessing: "${text}" -> "${cleanedText}"`);
  return cleanedText;
}

// ====================
// FALLBACK APPOINTMENT PARSER
// ====================
/**
 * Catches common appointment phrases that chrono might miss
 * This is your safety net for patient scheduling
 */
function fallbackAppointmentParser(text, timezone) {
  const lowerText = text.toLowerCase().trim();
  const today = moment.tz(timezone);
  
  // Common appointment request patterns
  const appointmentPatterns = {
    'any time this week': {
      date: today.clone().endOf('week').format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'high',
      flexible: true,
      date_range: {
        start: today.clone().startOf('week').format('YYYY-MM-DD'),
        end: today.clone().endOf('week').format('YYYY-MM-DD')
      }
    },
    'any time next week': {
      date: today.clone().add(1, 'week').endOf('week').format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'high',
      flexible: true,
      date_range: {
        start: today.clone().add(1, 'week').startOf('week').format('YYYY-MM-DD'),
        end: today.clone().add(1, 'week').endOf('week').format('YYYY-MM-DD')
      }
    },
    'whenever': {
      date: today.clone().add(7, 'days').format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'medium',
      flexible: true,
      note: 'Patient is flexible - suggest next available'
    },
    'as soon as possible': {
      date: today.format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'high',
      urgent: true,
      note: 'Patient needs urgent appointment'
    },
    'asap': {
      date: today.format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'high',
      urgent: true,
      note: 'Patient needs urgent appointment'
    },
    'next available': {
      date: today.format('YYYY-MM-DD'),
      time_of_day: 'any',
      confidence: 'high',
      urgent: true,
      note: 'Patient wants next available slot'
    }
  };
  
  // Check for exact matches
  if (appointmentPatterns[lowerText]) {
    console.log(`Fallback parser matched: "${lowerText}"`);
    return appointmentPatterns[lowerText];
  }
  
  // Check for partial pattern matches
  const partialPatterns = [
    {
      regex: /\b(any time|whenever)\s+(this|next)\s+week\b/i,
      handler: (match) => {
        const isNext = match.includes('next');
        const weekOffset = isNext ? 1 : 0;
        return {
          date: today.clone().add(weekOffset, 'week').endOf('week').format('YYYY-MM-DD'),
          time_of_day: 'any',
          confidence: 'high',
          flexible: true,
          date_range: {
            start: today.clone().add(weekOffset, 'week').startOf('week').format('YYYY-MM-DD'),
            end: today.clone().add(weekOffset, 'week').endOf('week').format('YYYY-MM-DD')
          }
        };
      }
    },
    {
      regex: /\b(morning|afternoon|evening)\s+(appointment|slot|time)\b/i,
      handler: (match) => {
        const timeOfDay = match.includes('morning') ? 'morning' : 
                         match.includes('afternoon') ? 'afternoon' : 'evening';
        return {
          date: today.format('YYYY-MM-DD'),
          time_of_day: timeOfDay,
          confidence: 'medium',
          note: `Patient prefers ${timeOfDay} appointment`
        };
      }
    },
    {
      regex: /\b(first|earliest)\s+(available|appointment|slot)\b/i,
      handler: () => ({
        date: today.format('YYYY-MM-DD'),
        time_of_day: 'any',
        confidence: 'high',
        urgent: true,
        note: 'Patient wants first available slot'
      })
    }
  ];
  
  // Try each pattern
  for (const pattern of partialPatterns) {
    const match = lowerText.match(pattern.regex);
    if (match) {
      console.log(`Fallback parser partial match: "${lowerText}"`);
      return pattern.handler(match[0]);
    }
  }
  
  return null;
}

// ====================
// PARTIAL INFO EXTRACTOR
// ====================
/**
 * Tries to extract ANY useful information from the text
 * Like salvaging clues from a garbled message
 */
function extractPartialTimeInfo(text) {
  const lowerText = text.toLowerCase();
  const extracted = {
    date: null,
    time_of_day: 'any',
    confidence: 'low',
    partial_info: {}
  };
  
  // Look for time of day preferences
  if (lowerText.includes('morning') || lowerText.includes('am')) {
    extracted.time_of_day = 'morning';
    extracted.partial_info.time_preference = 'morning';
  } else if (lowerText.includes('afternoon') || lowerText.includes('pm')) {
    extracted.time_of_day = 'afternoon';
    extracted.partial_info.time_preference = 'afternoon';
  } else if (lowerText.includes('evening') || lowerText.includes('night')) {
    extracted.time_of_day = 'evening';
    extracted.partial_info.time_preference = 'evening';
  }
  
  // Look for urgency indicators
  if (lowerText.includes('urgent') || lowerText.includes('asap') || 
      lowerText.includes('emergency') || lowerText.includes('soon')) {
    extracted.urgent = true;
    extracted.partial_info.urgency = 'high';
  }
  
  // Look for flexibility indicators
  if (lowerText.includes('any') || lowerText.includes('flexible') || 
      lowerText.includes('whenever') || lowerText.includes('open')) {
    extracted.flexible = true;
    extracted.partial_info.flexibility = 'high';
  }
  
  // Look for day references
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    if (lowerText.includes(day)) {
      extracted.partial_info.mentioned_day = day;
    }
  }
  
  // Only return if we found something useful
  if (Object.keys(extracted.partial_info).length > 0) {
    return extracted;
  }
  
  return null;
}

// ====================
// ORIGINAL CHRONO PARSER (UPDATED)
// ====================
/**
 * Original parser using chrono-node library
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
 * Helper: Determine time of day from parsed result
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
 * Helper: Determine confidence level of the parse
 */
function determineConfidence(result, originalText) {
  const lowerText = originalText.toLowerCase();

  // High confidence if we have complete date components
  if (result.start.get('year') !== undefined && 
      result.start.get('month') !== undefined && 
      result.start.get('day') !== undefined) {
    return 'high';
  }
  
  // High confidence keywords
  const highConfidenceKeywords = [
    'today', 'tomorrow', 'yesterday',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  if (highConfidenceKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'high';
  }
  
  // Medium confidence keywords
  const mediumConfidenceKeywords = [
    'next', 'this', 'last', 'week', 'month', 'year',
    'morning', 'afternoon', 'evening', 'night'
  ];
  
  if (mediumConfidenceKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'medium';
  }
  
  return 'low';
}

// ====================
// MULTI-STRATEGY PARSER
// ====================
/**
 * Main parsing function that tries multiple strategies
 * This is your master coordinator that ensures we always give a response
 */
function parseNaturalTimeWithFallbacks(naturalTime, timezone) {
  const strategies = [];
  
  // Strategy 1: Try chrono-node first
  try {
    const chronoResult = parseNaturalTime(naturalTime, timezone);
    if (chronoResult.date && chronoResult.confidence !== 'low') {
      console.log('✓ Chrono-node succeeded');
      return { ...chronoResult, parser: 'chrono' };
    }
    strategies.push({ name: 'chrono', result: chronoResult });
  } catch (error) {
    console.log('✗ Chrono-node failed:', error.message);
  }
  
  // Strategy 2: Try the fallback parser
  const fallbackResult = fallbackAppointmentParser(naturalTime, timezone);
  if (fallbackResult) {
    console.log('✓ Fallback parser succeeded');
    return { ...fallbackResult, parser: 'fallback' };
  }
  
  // Strategy 3: Try to extract partial information
  const extractedInfo = extractPartialTimeInfo(naturalTime);
  if (extractedInfo) {
    console.log('✓ Extracted partial information');
    return { ...extractedInfo, parser: 'extraction' };
  }
  
  // Strategy 4: Return a clarification request
  console.log('⚠ All parsers failed - requesting clarification');
  return {
    date: null,
    time_of_day: 'any',
    confidence: 'none',
    needs_clarification: true,
    original_input: naturalTime,
    suggested_responses: [
      "Could you please specify a day? For example: 'Tomorrow' or 'Next Monday'",
      "What day works best for you?",
      "Would you prefer morning or afternoon?"
    ],
    parser: 'none'
  };
}

// ====================
// MAIN API ENDPOINT
// ====================
/**
 * The main endpoint that processes appointment requests
 */
app.post('/api/enhanced-parse-natural-time', async (req, res) => {
  try {
    // Validate input
    if (!req.body.data || !req.body.data.datetime_request) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: data.datetime_request',
        parsed: null
      });
    }
    
    const { datetime_request: natural_time, timezone } = req.body.data;
    const tz = timezone || 'America/New_York';
    
    // Validate timezone
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        success: false,
        message: `Invalid timezone: ${timezone}. Please use a valid IANA timezone identifier.`, 
        parsed: null
      });
    }
    
    // Step 1: Grammar correction with Google NLP
    const corrected_natural_time = await analyzeAndCorrectText(natural_time);
    
    // Step 2: Preprocessing (numbers + word separation + typos)
    const cleaned_natural_time = preprocessNaturalTime(corrected_natural_time);
    
    // Step 3: Multi-strategy parsing
    const parsedResult = parseNaturalTimeWithFallbacks(cleaned_natural_time, tz);
    
    // Step 4: Prepare appropriate response
    if (parsedResult.needs_clarification) {
      // Couldn't parse - need clarification
      res.json({
        success: false,
        message: 'Need clarification for appointment scheduling',
        parsed: parsedResult,
        clarification_needed: true,
        suggested_prompts: parsedResult.suggested_responses,
        original_input: natural_time,
        processed_input: cleaned_natural_time,
        partial_understanding: parsedResult.partial_info || {}
      });
    } else if (parsedResult.date) {
      // Success! We have a date
      res.json({
        success: true,
        message: 'Successfully parsed appointment request',
        parsed: parsedResult,
        original_input: natural_time,
        processed_input: cleaned_natural_time,
        scheduling_notes: {
          flexible: parsedResult.flexible || false,
          urgent: parsedResult.urgent || false,
          date_range: parsedResult.date_range || null,
          parser_used: parsedResult.parser,
          note: parsedResult.note || null
        }
      });
    } else {
      // Partial success - we got some info but not a complete date
      res.json({
        success: false,
        message: 'Partially understood appointment request',
        parsed: parsedResult,
        original_input: natural_time,
        processed_input: cleaned_natural_time,
        partial_info: parsedResult.partial_info || {},
        suggestion: 'Please provide a specific day for the appointment'
      });
    }
    
  } catch (error) {
    console.error('Error in appointment parsing:', error);
    
    // Even in errors, provide helpful response
    res.status(200).json({
      success: false,
      message: 'Could not process appointment request',
      parsed: null,
      fallback_response: 'When would you like to schedule your appointment? You can say things like "tomorrow morning" or "any time next week".',
      error_details: error.message
    });
  }
});

// ====================
// TEST ENDPOINTS
// ====================
/**
 * Test endpoint for preprocessing steps
 */
app.post('/api/test-preprocessing', (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({
      error: 'Please provide text to test'
    });
  }
  
  const afterNumbers = convertSpokenNumbersToDigits(text);
  const afterSeparation = enhancedWordSeparation(afterNumbers);
  const final = preprocessNaturalTime(text);
  
  res.json({
    original: text,
    step1_numbers: afterNumbers,
    step2_separation: afterSeparation,
    final_result: final,
    explanation: "Each step shows how the text transforms"
  });
});

/**
 * Test endpoint for common appointment scenarios
 */
app.post('/api/test-appointment-parsing', async (req, res) => {
  const testCases = [
    "anytime this week",
    "anytimethisweek",
    "tomorrow morning",
    "tomorrowmorning",
    "four fifteen ninety four",
    "whenever is good",
    "asap",
    "next available",
    "thursday afternoon",
    "any time next week",
    "first available slot",
    "garbage text xyz123"
  ];
  
  const timezone = req.body.timezone || 'America/New_York';
  
  const results = await Promise.all(testCases.map(async (testCase) => {
    const corrected = await analyzeAndCorrectText(testCase);
    const cleaned = preprocessNaturalTime(corrected);
    const parsed = parseNaturalTimeWithFallbacks(cleaned, timezone);
    
    return {
      input: testCase,
      cleaned: cleaned,
      result: parsed,
      success: parsed.date !== null
    };
  }));
  
  res.json({
    test_results: results,
    summary: {
      total: results.length,
      successful: results.filter(r => r.success).length,
      partial: results.filter(r => r.result.partial_info && !r.success).length,
      needs_clarification: results.filter(r => r.result.needs_clarification).length
    }
  });
});

/**
 * Test a single input with detailed debugging
 */
app.post('/api/debug-parse', async (req, res) => {
  const { text, timezone = 'America/New_York' } = req.body;
  
  if (!text) {
    return res.status(400).json({
      error: 'Please provide text to debug'
    });
  }
  
  const steps = {};
  
  // Track each step
  steps.original = text;
  steps.after_google_nlp = await analyzeAndCorrectText(text);
  steps.after_numbers = convertSpokenNumbersToDigits(steps.after_google_nlp);
  steps.after_separation = enhancedWordSeparation(steps.after_numbers);
  steps.final_preprocessed = preprocessNaturalTime(steps.after_google_nlp);
  
  // Try each parser individually
  steps.chrono_result = parseNaturalTime(steps.final_preprocessed, timezone);
  steps.fallback_result = fallbackAppointmentParser(steps.final_preprocessed, timezone);
  steps.extraction_result = extractPartialTimeInfo(steps.final_preprocessed, timezone);
  steps.final_result = parseNaturalTimeWithFallbacks(steps.final_preprocessed, timezone);
  
  res.json({
    input: text,
    processing_steps: steps,
    final_outcome: {
      success: steps.final_result.date !== null,
      parser_used: steps.final_result.parser,
      result: steps.final_result
    }
  });
});

// ====================
// SERVER STARTUP
// ====================
app.listen(PORT, () => {
  console.log(`🏥 Enhanced Appointment Parser Service`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Main endpoint: http://localhost:${PORT}/api/enhanced-parse-natural-time`);
  console.log(`🧪 Test endpoints:`);
  console.log(`   - http://localhost:${PORT}/api/test-preprocessing`);
  console.log(`   - http://localhost:${PORT}/api/test-appointment-parsing`);
  console.log(`   - http://localhost:${PORT}/api/debug-parse`);
  console.log(`💊 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;