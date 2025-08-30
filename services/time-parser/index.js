const express = require('express');
const cors = require('cors');
const moment = require('moment-timezone');
const NodeCache = require('node-cache');

// Initialize services
const app = express();
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min cache for parsed patterns

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || 
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'time-parser',
    cache_entries: cache.keys().length
  });
});

// Warmup endpoint for Cloud Run
app.get('/_ah/warmup', (req, res) => {
  // Pre-cache common patterns
  preloadCommonPatterns();
  res.status(200).send('OK');
});

// Main natural time parsing endpoint
app.post('/api/enhanced-parse-natural-time', async (req, res) => {
  const startTime = Date.now();
  const { requestId } = req;
  
  try {
    const { natural_time, timezone = 'America/New_York' } = req.body;
    
    console.log(`[${requestId}] Natural time parsing request:`, { 
      natural_time, 
      timezone 
    });
    
    // Validate input
    if (!natural_time) {
      return res.status(400).json({
        error: 'Natural time is required',
        message: 'Please provide a natural time request',
        date: null,
        time_of_day: null,
        confidence: null
      });
    }
    
    // Normalize and clean input
    const normalizedInput = normalizePhrases(natural_time);
    
    // Check cache for this exact pattern
    const cacheKey = `parse:${normalizedInput}:${timezone}`;
    const cachedResult = cache.get(cacheKey);
    
    if (cachedResult) {
      console.log(`[${requestId}] Cache hit for pattern: ${normalizedInput}`);
      return res.json({
        ...cachedResult,
        cached: true,
        response_time: Date.now() - startTime
      });
    }
    
    // Parse the natural time
    const result = parseNaturalTime(normalizedInput, timezone, requestId);
    
    // Cache successful high-confidence results
    if (result.confidence === 'high') {
      cache.set(cacheKey, result);
    }
    
    // Return response
    res.json({
      ...result,
      response_time: Date.now() - startTime
    });
    
  } catch (error) {
    console.error(`[${requestId}] Time parsing error:`, error);
    res.status(500).json({
      error: 'Failed to parse natural time',
      message: error.message,
      date: null,
      time_of_day: null,
      confidence: null,
      requestId,
      response_time: Date.now() - startTime
    });
  }
});

// Helper Functions

function normalizePhrases(rawInput) {
  // This function handles ASR quirks and common speech patterns
  let s = String(rawInput || '').toLowerCase();
  
  // Remove punctuation that speech recognition might insert
  s = s.replace(/[\.,;:!_\-\/]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  
  // Handle collapsed week phrases that often come from speech
  const phraseMap = {
    'anytimethisweek': 'anytime this week',
    'anytimenextweek': 'anytime next week',
    'any time thisweek': 'anytime this week',
    'any time nextweek': 'anytime next week',
    'thisweek': 'this week',
    'nextweek': 'next week',
    'thiscomingweek': 'this coming week',
    'comingweek': 'coming week'
  };
  
  for (const [pattern, replacement] of Object.entries(phraseMap)) {
    s = s.replace(new RegExp(pattern, 'g'), replacement);
  }
  
  // Normalize common synonyms to canonical forms
  s = s
    .replace(/this coming week/g, 'this week')
    .replace(/coming week/g, 'this week')
    .replace(/\bin next week\b/g, 'in the next week')
    .replace(/in the next week/g, 'anytime in the next week')
    .replace(/the next week/g, 'next week')
    .replace(/next seven days/g, 'anytime in the next seven days')
    .replace(/next 7 days/g, 'anytime in the next seven days')
    .replace(/whenever( works)?/g, 'anytime')
    .replace(/no preference/g, 'anytime')
    .replace(/soonest|asap|as soon as possible|next available|first available/g, 'next available')
    .replace(/end of day|eod|after work|after hours/g, 'evening')
    .replace(/first thing|before work/g, 'morning')
    .replace(/tonight|this evening/g, 'evening')
    .replace(/mid\s*day|lunch(\s*time)?/g, 'noon');
  
  return s;
}

function parseNaturalTime(normalizedInput, timezone, requestId) {
  const currentDate = moment.tz(timezone);
  
  console.log(`[${requestId}] Processing normalized input: "${normalizedInput}"`);
  
  // Helper function to compute Sunday-to-Saturday week ranges
  const computeSundayWeekRange = (base, isNext = false) => {
    const baseDay = base.clone().startOf('day');
    const dow = baseDay.day(); // 0=Sunday, 6=Saturday
    const currentSunday = baseDay.clone().subtract(dow, 'days');
    const sundayStart = isNext ? currentSunday.clone().add(7, 'days') : currentSunday;
    const saturdayEnd = sundayStart.clone().add(6, 'days');
    return { sundayStart, saturdayEnd, today: baseDay };
  };
  
  // Check for broad time ranges first (these are most common from Bland.ai)
  const broadPatterns = {
    'anytime this week': () => {
      const { sundayStart, saturdayEnd, today } = computeSundayWeekRange(currentDate, false);
      const start = moment.max(sundayStart, today); // Don't include past days
      return {
        start: start.format('YYYY-MM-DD'),
        end: saturdayEnd.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'anytime in the next week': () => {
      const today = currentDate.clone();
      const sevenDaysLater = currentDate.clone().add(7, 'days');
      return {
        start: today.format('YYYY-MM-DD'),
        end: sevenDaysLater.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'anytime next week': () => {
      const { sundayStart, saturdayEnd } = computeSundayWeekRange(currentDate, true);
      return {
        start: sundayStart.format('YYYY-MM-DD'),
        end: saturdayEnd.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'this week': () => {
      const { sundayStart, saturdayEnd, today } = computeSundayWeekRange(currentDate, false);
      const start = moment.max(sundayStart, today);
      return {
        start: start.format('YYYY-MM-DD'),
        end: saturdayEnd.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'next week': () => {
      const { sundayStart, saturdayEnd } = computeSundayWeekRange(currentDate, true);
      return {
        start: sundayStart.format('YYYY-MM-DD'),
        end: saturdayEnd.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'anytime': () => {
      const today = currentDate.clone();
      const twoWeeksLater = currentDate.clone().add(14, 'days');
      return {
        start: today.format('YYYY-MM-DD'),
        end: twoWeeksLater.format('YYYY-MM-DD'),
        is_range: true
      };
    },
    'next available': () => {
      const today = currentDate.clone();
      const twoWeeksLater = currentDate.clone().add(14, 'days');
      return {
        start: today.format('YYYY-MM-DD'),
        end: twoWeeksLater.format('YYYY-MM-DD'),
        is_range: true
      };
    }
  };
  
  // Check broad patterns
  for (const [pattern, handler] of Object.entries(broadPatterns)) {
    if (normalizedInput.includes(pattern)) {
      const range = handler();
      const daysToCheck = generateDateArray(range.start, range.end);
      const timeOfDay = detectTimeOfDay(normalizedInput);
      
      console.log(`[${requestId}] Matched broad pattern: ${pattern}`);
      
      return {
        date: range.start,
        date_range: range,
        time_of_day: timeOfDay.time_of_day,
        state: 'any',
        is_multi_day: true,
        days_to_check: daysToCheck,
        confidence: 'high',
        request_type: 'broad',
        time_window: timeOfDay.window,
        message: `Successfully parsed date range: ${range.start} to ${range.end}`
      };
    }
  }
  
  // Check for specific dates
  const specificPatterns = {
    'tomorrow': () => currentDate.clone().add(1, 'day').format('YYYY-MM-DD'),
    'today': () => currentDate.format('YYYY-MM-DD'),
    'monday': () => getNextWeekday(currentDate, 1),
    'tuesday': () => getNextWeekday(currentDate, 2),
    'wednesday': () => getNextWeekday(currentDate, 3),
    'thursday': () => getNextWeekday(currentDate, 4),
    'friday': () => getNextWeekday(currentDate, 5),
    'saturday': () => getNextWeekday(currentDate, 6),
    'sunday': () => getNextWeekday(currentDate, 0)
  };
  
  for (const [pattern, handler] of Object.entries(specificPatterns)) {
    if (normalizedInput.includes(pattern)) {
      const date = handler();
      const timeOfDay = detectTimeOfDay(normalizedInput);
      
      console.log(`[${requestId}] Matched specific pattern: ${pattern}`);
      
      return {
        date: date,
        date_range: { start: date, end: date },
        time_of_day: timeOfDay.time_of_day,
        state: 'any',
        is_multi_day: false,
        days_to_check: [date],
        confidence: 'high',
        request_type: 'specific',
        time_window: timeOfDay.window,
        message: `Successfully parsed specific date: ${date}`
      };
    }
  }
  
  // Check for month-day patterns (e.g., "January 15", "Jan 15")
  const monthDayMatch = normalizedInput.match(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+(\d{1,2})\b/i
  );
  
  if (monthDayMatch) {
    const monthName = monthDayMatch[1];
    const day = parseInt(monthDayMatch[2]);
    const monthMap = {
      'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
      'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
      'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
      'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
    };
    
    const month = monthMap[monthName.toLowerCase()];
    let year = currentDate.year();
    
    // If the date has passed this year, assume next year
    const testDate = moment.tz({ year, month, day }, timezone);
    if (testDate.isBefore(currentDate, 'day')) {
      year++;
    }
    
    const date = moment.tz({ year, month, day }, timezone).format('YYYY-MM-DD');
    const timeOfDay = detectTimeOfDay(normalizedInput);
    
    console.log(`[${requestId}] Matched month-day pattern: ${monthName} ${day}`);
    
    return {
      date: date,
      date_range: { start: date, end: date },
      time_of_day: timeOfDay.time_of_day,
      state: 'any',
      is_multi_day: false,
      days_to_check: [date],
      confidence: 'high',
      request_type: 'specific',
      time_window: timeOfDay.window,
      message: `Successfully parsed date: ${date}`
    };
  }
  
  // Default fallback - couldn't parse the date
  console.log(`[${requestId}] Could not parse specific date, using fallback`);
  const timeOfDay = detectTimeOfDay(normalizedInput);
  
  return {
    date: currentDate.format('YYYY-MM-DD'),
    date_range: {
      start: currentDate.format('YYYY-MM-DD'),
      end: currentDate.clone().add(7, 'days').format('YYYY-MM-DD')
    },
    time_of_day: timeOfDay.time_of_day,
    state: 'any',
    is_multi_day: true,
    days_to_check: [currentDate.format('YYYY-MM-DD')],
    confidence: 'low',
    request_type: 'fallback',
    time_window: timeOfDay.window,
    message: 'Could not parse specific date, using current week as fallback'
  };
}

function detectTimeOfDay(input) {
  // This function detects time-of-day preferences in the input
  const result = { time_of_day: 'any', window: null };
  
  // Check for specific time patterns
  const patterns = {
    morning: {
      regex: /(early\s+)?morning\b/i,
      window: { start: 8 * 60, end: 12 * 60 - 1 }
    },
    afternoon: {
      regex: /(early\s+afternoon|late\s+afternoon|\bafternoon)\b/i,
      window: { start: 12 * 60, end: 17 * 60 - 1 }
    },
    evening: {
      regex: /(early\s+evening|late\s+evening|\bevening|tonight|this evening)\b/i,
      window: { start: 17 * 60, end: 21 * 60 - 1 }
    },
    night: {
      regex: /\bnight\b/i,
      window: { start: 21 * 60, end: 23 * 60 }
    },
    noon: {
      regex: /\bnoon|mid\s*day|lunch(\s*time)?\b/i,
      window: { start: 12 * 60, end: 12 * 60 }
    }
  };
  
  for (const [timeOfDay, config] of Object.entries(patterns)) {
    if (config.regex.test(input)) {
      result.time_of_day = timeOfDay === 'noon' ? 'midday' : timeOfDay;
      result.window = config.window;
      
      // Handle early/late modifiers
      if (timeOfDay === 'morning' && /early\s+morning/i.test(input)) {
        result.window = { start: 8 * 60, end: 10 * 60 - 1 };
      } else if (timeOfDay === 'morning' && /late\s+morning/i.test(input)) {
        result.window = { start: 10 * 60, end: 12 * 60 - 1 };
      } else if (timeOfDay === 'afternoon' && /early\s+afternoon/i.test(input)) {
        result.window = { start: 12 * 60, end: 14 * 60 - 1 };
      } else if (timeOfDay === 'afternoon' && /late\s+afternoon/i.test(input)) {
        result.window = { start: 15 * 60, end: 17 * 60 - 1 };
      } else if (timeOfDay === 'evening' && /early\s+evening/i.test(input)) {
        result.window = { start: 17 * 60, end: 19 * 60 - 1 };
      } else if (timeOfDay === 'evening' && /late\s+evening/i.test(input)) {
        result.window = { start: 19 * 60, end: 21 * 60 - 1 };
      }
      
      break;
    }
  }
  
  // Check for specific time mentions (e.g., "after 3pm", "before 10am")
  const timeMatch = input.match(/\b(after|before|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    const [, preposition, hour, minute, ampm] = timeMatch;
    let hours = parseInt(hour);
    const minutes = minute ? parseInt(minute) : 0;
    
    if (ampm) {
      const isPM = ampm.toLowerCase() === 'pm';
      if (hours === 12) hours = 0;
      hours = hours + (isPM ? 12 : 0);
    }
    
    const totalMinutes = hours * 60 + minutes;
    
    if (preposition.toLowerCase() === 'after') {
      result.filter = { type: 'after', start: totalMinutes };
    } else if (preposition.toLowerCase() === 'before') {
      result.filter = { type: 'before', end: totalMinutes };
    } else if (preposition.toLowerCase() === 'around') {
      result.filter = { type: 'around', exact: totalMinutes, tolerance: 30 };
    }
  }
  
  return result;
}

function getNextWeekday(currentDate, targetDay) {
  // Get the next occurrence of a weekday (0=Sunday, 6=Saturday)
  const current = currentDate.clone();
  const currentDay = current.day();
  
  if (currentDay <= targetDay) {
    // Target day is later this week
    return current.day(targetDay).format('YYYY-MM-DD');
  } else {
    // Target day is next week
    return current.add(1, 'week').day(targetDay).format('YYYY-MM-DD');
  }
}

function generateDateArray(startDate, endDate) {
  // Generate array of dates between start and end (inclusive)
  const dates = [];
  const current = moment(startDate);
  const end = moment(endDate);
  
  while (current.isSameOrBefore(end)) {
    dates.push(current.format('YYYY-MM-DD'));
    current.add(1, 'day');
  }
  
  return dates;
}

function preloadCommonPatterns() {
  // Pre-cache very common patterns to improve response time
  const commonPatterns = [
    'anytime this week',
    'anytime next week',
    'tomorrow',
    'today',
    'next available'
  ];
  
  const timezone = 'America/New_York';
  
  for (const pattern of commonPatterns) {
    const normalized = normalizePhrases(pattern);
    const result = parseNaturalTime(normalized, timezone, 'preload');
    const cacheKey = `parse:${normalized}:${timezone}`;
    cache.set(cacheKey, result);
  }
  
  console.log(`Preloaded ${commonPatterns.length} common patterns`);
}

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`Natural time parser service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  
  // Pre-warm cache
  preloadCommonPatterns();
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