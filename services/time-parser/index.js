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

// Natural language time parser endpoint
app.post('/api/enhanced-parse-natural-time', (req, res) => {
  try {
    const { natural_time, timezone } = req.body;

    // Validate required fields
    if (!natural_time) {
      return res.status(400).json({
        error: 'Missing required field: natural_time',
        date: null,
        time_of_day: null,
        confidence: null
      });
    }

    // Set default timezone if not provided
    const tz = timezone || 'America/New_York';

    // Validate timezone
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        error: `Invalid timezone: ${timezone}. Please use a valid IANA timezone identifier.`,
        date: null,
        time_of_day: null,
        confidence: null
      });
    }

    // Parse the natural language time
    const parsedResult = parseNaturalTime(natural_time, tz);

    // Return the parsed result
    res.json(parsedResult);

  } catch (error) {
    console.error('Error parsing natural time:', error);
    res.status(500).json({
      error: 'Internal server error',
      date: null,
      time_of_day: null,
      confidence: null
    });
  }
});

/**
 * Parse natural language time using chrono-node
 * @param {string} naturalTime - The natural language time string
 * @param {string} timezone - The timezone to use for parsing
 * @returns {object} - Parsed date, time of day, and confidence
 */
function parseNaturalTime(naturalTime, timezone) {
  try {
    // Create a reference date in the specified timezone
    const referenceDate = moment.tz(timezone).toDate();
    
    // Parse the natural language text
    const results = chrono.parse(naturalTime, referenceDate, { 
      forwardDate: true // Prefer future dates [[memory:5748794]]
    });

    // If no results, try with casual parsing
    if (!results || results.length === 0) {
      const casualResults = chrono.casual.parse(naturalTime, referenceDate, {
        forwardDate: true
      });
      
      if (!casualResults || casualResults.length === 0) {
        return {
          date: null,
          time_of_day: 'any',
          confidence: 'low'
        };
      }
      
      results.push(...casualResults);
    }

    // Get the first (most likely) result
    const result = results[0];
    
    if (!result || !result.start) {
      return {
        date: null,
        time_of_day: 'any',
        confidence: 'low'
      };
    }

    // Extract the parsed date
    const parsedDate = result.start.date();
    
    // Convert to the specified timezone
    const dateInTimezone = moment.tz(parsedDate, timezone);
    
    // Format the date as YYYY-MM-DD
    const formattedDate = dateInTimezone.format('YYYY-MM-DD');
    
    // Determine time of day
    const timeOfDay = determineTimeOfDay(result, naturalTime);
    
    // Determine confidence level
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
  
  // Check for explicit time of day mentions
  if (lowerText.includes('morning') || lowerText.includes('am')) {
    return 'morning';
  }
  if (lowerText.includes('afternoon') || lowerText.includes('pm') && !lowerText.includes('evening')) {
    return 'afternoon';
  }
  if (lowerText.includes('evening') || lowerText.includes('night') || lowerText.includes('tonight')) {
    return 'evening';
  }
  
  // Check if a specific hour was mentioned
  if (result.start.get('hour') !== undefined) {
    const hour = result.start.get('hour');
    
    if (hour >= 5 && hour < 12) {
      return 'morning';
    } else if (hour >= 12 && hour < 17) {
      return 'afternoon';
    } else if (hour >= 17 && hour < 24) {
      return 'evening';
    } else {
      return 'evening'; // Late night/early morning
    }
  }
  
  // Check for meal-related times
  if (lowerText.includes('breakfast')) {
    return 'morning';
  }
  if (lowerText.includes('lunch')) {
    return 'afternoon';
  }
  if (lowerText.includes('dinner') || lowerText.includes('supper')) {
    return 'evening';
  }
  
  // Default to 'any' if no specific time of day can be determined
  return 'any';
}

/**
 * Determine the confidence level of the parse
 * @param {object} result - Chrono parse result
 * @param {string} originalText - Original natural language text
 * @returns {string} - Confidence level (high/medium/low)
 */
function determineConfidence(result, originalText) {
  // High confidence criteria
  if (result.start.get('year') !== undefined && 
      result.start.get('month') !== undefined && 
      result.start.get('day') !== undefined) {
    // Full date specified
    return 'high';
  }
  
  // Check for specific date keywords that indicate high confidence
  const lowerText = originalText.toLowerCase();
  const highConfidenceKeywords = [
    'today', 'tomorrow', 'yesterday',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  const hasHighConfidenceKeyword = highConfidenceKeywords.some(keyword => 
    lowerText.includes(keyword)
  );
  
  if (hasHighConfidenceKeyword && result.text && result.text.length > 3) {
    return 'high';
  }
  
  // Medium confidence criteria
  const mediumConfidenceKeywords = [
    'next', 'this', 'last', 'week', 'month', 'year',
    'morning', 'afternoon', 'evening', 'night'
  ];
  
  const hasMediumConfidenceKeyword = mediumConfidenceKeywords.some(keyword => 
    lowerText.includes(keyword)
  );
  
  if (hasMediumConfidenceKeyword || 
      (result.start.get('month') !== undefined && result.start.get('day') !== undefined)) {
    return 'medium';
  }
  
  // Low confidence for everything else
  return 'low';
}

// Additional endpoint for testing/debugging
app.post('/api/parse-natural-time-debug', (req, res) => {
  try {
    const { natural_time, timezone } = req.body;
    
    if (!natural_time) {
      return res.status(400).json({
        error: 'Missing required field: natural_time'
      });
    }
    
    const tz = timezone || 'America/New_York';
    const referenceDate = moment.tz(tz).toDate();
    
    // Get both strict and casual parsing results for debugging
    const strictResults = chrono.parse(natural_time, referenceDate, { forwardDate: true });
    const casualResults = chrono.casual.parse(natural_time, referenceDate, { forwardDate: true });
    
    res.json({
      input: natural_time,
      timezone: tz,
      reference_date: referenceDate.toISOString(),
      strict_results: strictResults.map(r => ({
        text: r.text,
        index: r.index,
        start: r.start.date().toISOString(),
        components: {
          year: r.start.get('year'),
          month: r.start.get('month'),
          day: r.start.get('day'),
          hour: r.start.get('hour'),
          minute: r.start.get('minute')
        }
      })),
      casual_results: casualResults.map(r => ({
        text: r.text,
        index: r.index,
        start: r.start.date().toISOString(),
        components: {
          year: r.start.get('year'),
          month: r.start.get('month'),
          day: r.start.get('day'),
          hour: r.start.get('hour'),
          minute: r.start.get('minute')
        }
      })),
      parsed_result: parseNaturalTime(natural_time, tz)
    });
  } catch (error) {
    console.error('Debug parsing error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Natural Language Time Parser service running on port ${PORT}`);
  console.log(`Main endpoint: http://localhost:${PORT}/api/enhanced-parse-natural-time`);
  console.log(`Debug endpoint: http://localhost:${PORT}/api/parse-natural-time-debug`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
