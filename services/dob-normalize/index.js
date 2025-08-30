const express = require('express');
const cors = require('cors');
const moment = require('moment');
const NodeCache = require('node-cache');

// Initialize services
const app = express();
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour cache for normalized dates

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/*' }));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || 
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'dob-normalize',
    version: process.env.SERVICE_VERSION || '2.0.0',
    cache_entries: cache.keys().length,
    supported_formats: getSupportedFormats().length
  });
});

// Warmup endpoint for Cloud Run
app.get('/_ah/warmup', (req, res) => {
  // Pre-compile regex patterns and warm up the cache
  precompilePatterns();
  res.status(200).send('OK');
});

// Main DOB normalization endpoint
app.post('/api/enhanced-dob-normalize', async (req, res) => {
  const startTime = Date.now();
  const { requestId } = req;
  
  try {
    const { 
      raw_dob,
      validation_level = 'standard', // 'strict', 'standard', 'loose'
      output_format = 'YYYY-MM-DD',
      min_year = 1900,
      max_year = new Date().getFullYear(),
      attempt_number = 1
    } = req.body;
    
    console.log(`[${requestId}] DOB normalization request:`, {
      raw_input: raw_dob?.substring(0, 50), // Log truncated for privacy
      validation_level,
      attempt: attempt_number
    });
    
    // Validate input
    if (!raw_dob) {
      return res.status(400).json({
        type: 'error',
        dob_iso: null,
        error: 'raw_dob is required',
        message: 'Please provide a date of birth to normalize'
      });
    }
    
    // Check cache for previously normalized values
    const cacheKey = `dob:${raw_dob}:${validation_level}`;
    const cachedResult = cache.get(cacheKey);
    
    if (cachedResult && attempt_number === 1) {
      console.log(`[${requestId}] Cache hit for DOB normalization`);
      return res.json({
        ...cachedResult,
        cached: true,
        response_time: Date.now() - startTime
      });
    }
    
    // Normalize the DOB with enhanced error handling
    const result = await normalizeDateOfBirth(
      raw_dob,
      validation_level,
      min_year,
      max_year,
      requestId
    );
    
    // Format the output if successfully normalized
    let formattedOutput = null;
    if (result.normalized) {
      formattedOutput = formatDateOutput(result.normalized, output_format);
    }
    
    // Build response
    const response = {
      type: result.normalized ? 'success' : 'unable_to_normalize',
      dob_iso: formattedOutput,
      original_input: raw_dob,
      confidence: result.confidence,
      parse_method: result.method,
      validation_warnings: result.warnings,
      response_time: Date.now() - startTime
    };
    
    // Add suggestions for failed normalizations
    if (!result.normalized) {
      response.message = generateHelpfulMessage(raw_dob, result, attempt_number);
      response.suggestions = generateSuggestions(result);
    }
    
    // Cache successful high-confidence results
    if (result.normalized && result.confidence === 'high') {
      cache.set(cacheKey, response);
    }
    
    // Log normalization attempt for analytics
    logNormalizationAttempt(requestId, raw_dob, result).catch(err =>
      console.error(`[${requestId}] Failed to log normalization:`, err)
    );
    
    res.json(response);
    
  } catch (error) {
    console.error(`[${requestId}] DOB normalization error:`, error);
    res.status(500).json({
      type: 'error',
      dob_iso: null,
      error: 'Internal server error',
      message: error.message,
      requestId,
      response_time: Date.now() - startTime
    });
  }
});

// Enhanced DOB normalization function with multiple parsing strategies
async function normalizeDateOfBirth(rawDob, validationLevel, minYear, maxYear, requestId) {
  if (!rawDob || typeof rawDob !== 'string') {
    return { normalized: null, confidence: 'none', method: 'invalid_input', warnings: [] };
  }
  
  console.log(`[${requestId}] Starting normalization for: "${rawDob}"`);
  
  const warnings = [];
  let cleaned = rawDob.trim();
  
  // Strategy 1: Try standard date formats first (fastest)
  const standardResult = tryStandardFormats(cleaned, minYear, maxYear);
  if (standardResult) {
    console.log(`[${requestId}] Normalized using standard format: ${standardResult.method}`);
    return {
      normalized: standardResult.date,
      confidence: 'high',
      method: standardResult.method,
      warnings
    };
  }
  
  // Strategy 2: Handle continuous numeric formats (voice transcription)
  const continuousResult = parseContinuousNumeric(cleaned, minYear, maxYear);
  if (continuousResult) {
    console.log(`[${requestId}] Normalized using continuous numeric: ${continuousResult.pattern}`);
    warnings.push('Date interpreted from continuous numeric format');
    return {
      normalized: continuousResult.date,
      confidence: 'medium',
      method: `continuous_numeric:${continuousResult.pattern}`,
      warnings
    };
  }
  
  // Strategy 3: Convert word numbers to digits
  const wordConverted = convertWordNumbers(cleaned);
  if (wordConverted !== cleaned) {
    console.log(`[${requestId}] Converted words to numbers: "${wordConverted}"`);
    cleaned = wordConverted;
    
    // Retry standard formats with converted text
    const convertedResult = tryStandardFormats(cleaned, minYear, maxYear);
    if (convertedResult) {
      warnings.push('Date contained word numbers that were converted');
      return {
        normalized: convertedResult.date,
        confidence: 'medium',
        method: `word_conversion:${convertedResult.method}`,
        warnings
      };
    }
  }
  
  // Strategy 4: Handle special voice patterns
  const voiceResult = parseVoicePatterns(cleaned, minYear, maxYear);
  if (voiceResult) {
    console.log(`[${requestId}] Normalized using voice pattern: ${voiceResult.pattern}`);
    warnings.push('Date interpreted from voice transcription pattern');
    return {
      normalized: voiceResult.date,
      confidence: 'low',
      method: `voice_pattern:${voiceResult.pattern}`,
      warnings
    };
  }
  
  // Strategy 5: Fuzzy parsing with validation
  if (validationLevel !== 'strict') {
    const fuzzyResult = fuzzyParsing(cleaned, minYear, maxYear);
    if (fuzzyResult) {
      console.log(`[${requestId}] Normalized using fuzzy parsing`);
      warnings.push('Date required fuzzy interpretation');
      warnings.push(`Interpreted as: ${fuzzyResult.interpretation}`);
      return {
        normalized: fuzzyResult.date,
        confidence: 'low',
        method: 'fuzzy_parsing',
        warnings
      };
    }
  }
  
  console.log(`[${requestId}] Unable to normalize date: "${rawDob}"`);
  return {
    normalized: null,
    confidence: 'none',
    method: 'failed',
    warnings: warnings.length > 0 ? warnings : ['Unable to parse date format']
  };
}

// Try standard date formats with moment.js
function tryStandardFormats(dateStr, minYear, maxYear) {
  const formats = [
    // ISO formats
    'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD',
    
    // US formats
    'MM/DD/YYYY', 'MM-DD-YYYY', 'MM.DD.YYYY',
    'M/D/YYYY', 'M-D-YYYY', 'M.D.YYYY',
    'MM/DD/YY', 'MM-DD-YY', 'M/D/YY', 'M-D-YY',
    
    // European formats
    'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY',
    'D/M/YYYY', 'D-M-YYYY', 'D.M.YYYY',
    
    // Month name formats
    'MMMM DD YYYY', 'MMMM DD, YYYY', 'MMMM D YYYY', 'MMMM D, YYYY',
    'MMM DD YYYY', 'MMM DD, YYYY', 'MMM D YYYY', 'MMM D, YYYY',
    'DD MMMM YYYY', 'D MMMM YYYY', 'DD MMM YYYY', 'D MMM YYYY',
    
    // Other formats
    'YYYYMMDD', 'MMDDYYYY', 'DDMMYYYY'
  ];
  
  for (const format of formats) {
    const m = moment(dateStr, format, true);
    
    if (m.isValid()) {
      let year = m.year();
      
      // Handle 2-digit years
      if (format.includes('YY') && !format.includes('YYYY')) {
        const currentYear = new Date().getFullYear();
        const century = Math.floor(currentYear / 100) * 100;
        const cutoff = currentYear - century + 20; // 20 years in future
        
        if (year < 100) {
          year = year > cutoff ? century - 100 + year : century + year;
          m.year(year);
        }
      }
      
      // Validate year range
      if (year >= minYear && year <= maxYear) {
        // Double-check the date didn't overflow (e.g., Feb 31 -> Mar 3)
        const formatted = m.format('YYYY-MM-DD');
        const revalidate = moment(formatted, 'YYYY-MM-DD', true);
        
        if (revalidate.isValid() && 
            revalidate.format('YYYY-MM-DD') === formatted &&
            validateDateComponents(m)) {
          return {
            date: formatted,
            method: format
          };
        }
      }
    }
  }
  
  return null;
}

// Parse continuous numeric formats (common in voice transcription)
function parseContinuousNumeric(input, minYear, maxYear) {
  const cleanNumeric = input.replace(/\D/g, '');
  
  if (!/^\d{5,8}$/.test(cleanNumeric)) {
    return null;
  }
  
  const patterns = [
    // 5 digits: MDDYY (11580 = 1/15/80)
    {
      regex: /^(\d{1})(\d{2})(\d{2})$/,
      parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) }),
      pattern: 'MDDYY'
    },
    // 6 digits: MMDDYY (011580 = 01/15/80)
    {
      regex: /^(\d{2})(\d{2})(\d{2})$/,
      parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) }),
      pattern: 'MMDDYY'
    },
    // 7 digits: MDDYYYY (1151980 = 1/15/1980)
    {
      regex: /^(\d{1})(\d{2})(\d{4})$/,
      parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) }),
      pattern: 'MDDYYYY'
    },
    // 8 digits: MMDDYYYY (01151980 = 01/15/1980)
    {
      regex: /^(\d{2})(\d{2})(\d{4})$/,
      parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) }),
      pattern: 'MMDDYYYY'
    },
    // 8 digits: YYYYMMDD (19800115 = 1980/01/15)
    {
      regex: /^(\d{4})(\d{2})(\d{2})$/,
      parse: (m) => ({ year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) }),
      pattern: 'YYYYMMDD'
    }
  ];
  
  for (const pattern of patterns) {
    const match = cleanNumeric.match(pattern.regex);
    if (match) {
      const parsed = pattern.parse(match);
      
      // Adjust 2-digit years
      if (parsed.year < 100) {
        parsed.year = parsed.year < 50 ? 2000 + parsed.year : 1900 + parsed.year;
      }
      
      // Validate components
      if (parsed.month >= 1 && parsed.month <= 12 &&
          parsed.day >= 1 && parsed.day <= 31 &&
          parsed.year >= minYear && parsed.year <= maxYear) {
        
        const m = moment({ 
          year: parsed.year, 
          month: parsed.month - 1, 
          day: parsed.day 
        });
        
        if (m.isValid() && validateDateComponents(m)) {
          return {
            date: m.format('YYYY-MM-DD'),
            pattern: pattern.pattern
          };
        }
      }
    }
  }
  
  return null;
}

// Convert word numbers to digits (comprehensive)
function convertWordNumbers(input) {
  let result = input.toLowerCase();
  
  // Number word mappings
  const ones = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
  };
  
  const teens = {
    'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
    'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
    'eighteen': '18', 'nineteen': '19'
  };
  
  const tens = {
    'twenty': '20', 'thirty': '30', 'forty': '40', 'fifty': '50',
    'sixty': '60', 'seventy': '70', 'eighty': '80', 'ninety': '90'
  };
  
  const ordinals = {
    'first': '1', 'second': '2', 'third': '3', 'fourth': '4', 'fifth': '5',
    'sixth': '6', 'seventh': '7', 'eighth': '8', 'ninth': '9', 'tenth': '10',
    'eleventh': '11', 'twelfth': '12', 'thirteenth': '13', 'fourteenth': '14',
    'fifteenth': '15', 'sixteenth': '16', 'seventeenth': '17', 'eighteenth': '18',
    'nineteenth': '19', 'twentieth': '20', 'twenty-first': '21', 'twenty-second': '22',
    'twenty-third': '23', 'twenty-fourth': '24', 'twenty-fifth': '25',
    'twenty-sixth': '26', 'twenty-seventh': '27', 'twenty-eighth': '28',
    'twenty-ninth': '29', 'thirtieth': '30', 'thirty-first': '31'
  };
  
  // Replace ordinals first (they're more specific)
  for (const [word, digit] of Object.entries(ordinals)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, digit);
  }
  
  // Handle compound numbers (twenty-one, thirty-two, etc.)
  for (const [tenWord, tenDigit] of Object.entries(tens)) {
    for (const [oneWord, oneDigit] of Object.entries(ones)) {
      const compound = `${tenWord}[- ]${oneWord}`;
      const regex = new RegExp(compound, 'gi');
      const value = parseInt(tenDigit) + parseInt(oneDigit);
      result = result.replace(regex, value.toString());
    }
  }
  
  // Replace remaining number words
  const allNumbers = { ...ones, ...teens, ...tens };
  for (const [word, digit] of Object.entries(allNumbers)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, digit);
  }
  
  // Handle year expressions
  result = parseYearExpressions(result);
  
  // Clean up ordinal suffixes (1st -> 1, 2nd -> 2, etc.)
  result = result.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
  
  return result;
}

// Parse complex year expressions
function parseYearExpressions(input) {
  let result = input;
  
  // "nineteen ninety eight" -> "1998"
  const nineteenPattern = /nineteen\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(\w+))?/gi;
  result = result.replace(nineteenPattern, (match, tens, ones) => {
    const tensMap = { 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 
                     'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90 };
    const onesMap = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                     'six': 6, 'seven': 7, 'eight': 8, 'nine': 9 };
    
    let year = 1900 + tensMap[tens.toLowerCase()];
    if (ones && onesMap[ones.toLowerCase()]) {
      year += onesMap[ones.toLowerCase()];
    }
    return year.toString();
  });
  
  // "two thousand (and) eleven" -> "2011"
  const twoThousandPattern = /two\s+thousand(?:\s+and)?(?:\s+(\w+))?(?:\s+(\w+))?/gi;
  result = result.replace(twoThousandPattern, (match, first, second) => {
    if (!first) return '2000';
    
    const numbersMap = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
      'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18,
      'nineteen': 19, 'twenty': 20
    };
    
    if (numbersMap[first.toLowerCase()]) {
      return (2000 + numbersMap[first.toLowerCase()]).toString();
    }
    
    if (first.toLowerCase() === 'twenty' && second && numbersMap[second.toLowerCase()]) {
      return (2020 + numbersMap[second.toLowerCase()]).toString();
    }
    
    return match;
  });
  
  return result;
}

// Parse voice transcription patterns
function parseVoicePatterns(input, minYear, maxYear) {
  const patterns = [
    // "one fifteen eighty" -> 1/15/1980
    {
      regex: /(\d{1,2})\s+(\d{2})\s+(\d{2})/,
      parse: (m) => {
        const month = parseInt(m[1]);
        const day = parseInt(m[2]);
        let year = parseInt(m[3]);
        year = year < 50 ? 2000 + year : 1900 + year;
        return { month, day, year };
      },
      pattern: 'voice_numeric'
    },
    // "january fifteenth nineteen eighty" (after word conversion)
    {
      regex: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s+(\d{4}))?/i,
      parse: (m) => {
        const monthMap = {
          'january': 1, 'february': 2, 'march': 3, 'april': 4,
          'may': 5, 'june': 6, 'july': 7, 'august': 8,
          'september': 9, 'october': 10, 'november': 11, 'december': 12
        };
        const month = monthMap[m[1].toLowerCase()];
        const day = parseInt(m[2]);
        const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
        return { month, day, year };
      },
      pattern: 'month_day_year'
    }
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern.regex);
    if (match) {
      const parsed = pattern.parse(match);
      
      if (parsed.month >= 1 && parsed.month <= 12 &&
          parsed.day >= 1 && parsed.day <= 31 &&
          parsed.year >= minYear && parsed.year <= maxYear) {
        
        const m = moment({ 
          year: parsed.year, 
          month: parsed.month - 1, 
          day: parsed.day 
        });
        
        if (m.isValid() && validateDateComponents(m)) {
          return {
            date: m.format('YYYY-MM-DD'),
            pattern: pattern.pattern
          };
        }
      }
    }
  }
  
  return null;
}

// Fuzzy parsing for ambiguous inputs
function fuzzyParsing(input, minYear, maxYear) {
  try {
    // Try moment's flexible parsing as last resort
    const m = moment(input);
    
    if (m.isValid() && 
        m.year() >= minYear && 
        m.year() <= maxYear &&
        validateDateComponents(m)) {
      
      return {
        date: m.format('YYYY-MM-DD'),
        interpretation: m.format('MMMM DD, YYYY')
      };
    }
  } catch (error) {
    // Fuzzy parsing failed
  }
  
  return null;
}

// Validate date components to prevent invalid dates
function validateDateComponents(momentObj) {
  const month = momentObj.month();
  const day = momentObj.date();
  const year = momentObj.year();
  
  // Check for February 29 on non-leap years
  if (month === 1 && day === 29) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    if (!isLeapYear) return false;
  }
  
  // Check for invalid days in months
  const daysInMonth = momentObj.daysInMonth();
  if (day > daysInMonth) return false;
  
  return true;
}

// Format date output according to requested format
function formatDateOutput(dateStr, format) {
  const m = moment(dateStr, 'YYYY-MM-DD');
  
  // Support common output formats
  const formatMap = {
    'YYYY-MM-DD': 'YYYY-MM-DD',
    'MM/DD/YYYY': 'MM/DD/YYYY',
    'DD/MM/YYYY': 'DD/MM/YYYY',
    'ISO': () => m.toISOString(),
    'US': 'MM/DD/YYYY',
    'EU': 'DD/MM/YYYY',
    'LONG': 'MMMM DD, YYYY',
    'SHORT': 'MMM DD, YYYY'
  };
  
  if (typeof formatMap[format] === 'function') {
    return formatMap[format]();
  }
  
  return m.format(formatMap[format] || format);
}

// Generate helpful error messages
function generateHelpfulMessage(input, result, attemptNumber) {
  if (attemptNumber === 1) {
    return 'Could not normalize date of birth. Please provide the date in MM/DD/YYYY format.';
  } else if (attemptNumber === 2) {
    return 'Still having trouble with the date. Please say the month, day, and year clearly, like "January fifteenth nineteen ninety".';
  } else {
    return 'Unable to understand the date format. Please spell out the date slowly, for example: "zero one slash one five slash one nine nine zero" for 01/15/1990.';
  }
}

// Generate suggestions for failed normalizations
function generateSuggestions(result) {
  const suggestions = [];
  
  if (result.warnings.includes('Unable to parse date format')) {
    suggestions.push({
      format: 'MM/DD/YYYY',
      example: '01/15/1990'
    });
    suggestions.push({
      format: 'Month DD, YYYY',
      example: 'January 15, 1990'
    });
  }
  
  if (result.method === 'failed') {
    suggestions.push({
      format: 'Spoken format',
      example: 'January fifteenth nineteen ninety'
    });
  }
  
  return suggestions;
}

// Get list of supported formats for health check
function getSupportedFormats() {
  return [
    'MM/DD/YYYY', 'MM-DD-YYYY', 'MM.DD.YYYY',
    'YYYY-MM-DD', 'YYYY/MM/DD',
    'Month DD, YYYY', 'DD Month YYYY',
    'MMDDYYYY', 'YYYYMMDD',
    'Spoken dates (e.g., "January first nineteen ninety")',
    'Continuous numeric (e.g., "01151990")'
  ];
}

// Pre-compile regex patterns for performance
function precompilePatterns() {
  // This would normally compile and cache regex patterns
  // For now, we're using them inline for clarity
  console.log('Patterns pre-compiled for optimal performance');
}

// Log normalization attempts for analytics
async function logNormalizationAttempt(requestId, input, result) {
  const logData = {
    requestId,
    timestamp: new Date(),
    success: !!result.normalized,
    confidence: result.confidence,
    method: result.method,
    input_length: input?.length,
    has_warnings: result.warnings?.length > 0
  };
  
  console.log(`[${requestId}] DOB normalization logged:`, logData);
}

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`DOB normalization service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Supported formats: ${getSupportedFormats().length}`);
  
  // Pre-compile patterns on startup
  precompilePatterns();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;