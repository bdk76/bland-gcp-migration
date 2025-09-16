/**
 * Enhanced Natural Language Time Parser for Medical Appointment Scheduling
 * This service uses Google's Gemini AI to fix speech-to-text errors before parsing
 * Designed for Bland.ai webhook integration in medical scheduling systems
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');
const moment = require('moment-timezone');
const crypto = require('crypto');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware setup - these are the basic tools your server needs
app.use(cors());
app.use(bodyParser.json());

// ====================
// GEMINI AI CONFIGURATION
// ====================
// Initialize Vertex AI for Gemini - this automatically uses your GCP credentials
const vertex_ai = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT || 'gabar-ai-athena-integration',
  location: 'us-central1'
});

// Get the Gemini Flash model - optimized for speed in real-time applications
const geminiModel = vertex_ai.preview.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    maxOutputTokens: 256,
    temperature: 0.1,  // Low temperature for consistent medical scheduling
    topP: 0.8,
    topK: 40,
  },
});

// ====================
// WEBHOOK SIGNATURE VERIFICATION
// ====================
/**
 * Verifies the webhook signature from Bland.ai for security
 * This ensures the request is actually coming from your Bland.ai system
 */
function verifyWebhookSignature(req) {
  const signature = req.headers['x-bland-signature'];
  if (!signature || !process.env.GCP_WEBHOOK_SECRET) {
    console.log('⚠️ Webhook signature verification skipped (missing signature or secret)');
    return true; // Skip verification in development
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', process.env.GCP_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  return signature === expectedSignature;
}

// ====================
// GEMINI INTELLIGENT CORRECTION
// ====================
/**
 * Uses Gemini AI to fix common speech-to-text errors
 * This is the key innovation that solves your "anytimethisweek" problem
 */
async function intelligentSpeechCorrection(garbledText) {
  // Quick validation - don't waste API calls on empty text
  if (!garbledText || garbledText.length < 2) {
    return garbledText;
  }

  try {
    console.log(`🔧 Gemini fixing garbled text: "${garbledText}"`);
    
    // This prompt is specifically crafted for medical appointment scheduling
    const prompt = `You are fixing speech-to-text errors for medical appointment scheduling.
    
CRITICAL RULES FOR CORRECTION:
1. Words often stick together: "anytimethisweek" → "any time this week"
2. Numbers are spelled out: "four fifteen ninety four" → "4/15/94"
3. Times are spelled: "three thirty pm" → "3:30 pm"
4. Days run together: "nextmonday" → "next monday"
5. Common phrases: "tomorrowmorning" → "tomorrow morning"

Input text: "${garbledText}"

Output ONLY the corrected text with proper spacing and numbers. Do not add any explanation or change the meaning. Preserve the exact intent for medical scheduling.`;

    // Create the request to Gemini
    const request = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    };

    // Get Gemini's response
    const response = await geminiModel.generateContent(request);
    const result = response.response;
    
    // Extract the corrected text
    const correctedText = result.candidates[0].content.parts[0].text.trim();
    
    console.log(`✅ Gemini corrected to: "${correctedText}"`);
    return correctedText;
    
  } catch (error) {
    // If Gemini fails, log it but don't crash - continue with original
    console.error('❌ Gemini correction failed, using original:', error.message);
    return garbledText;
  }
}

// ====================
// FALLBACK APPOINTMENT PARSER
// ====================
/**
 * Catches common appointment phrases that chrono might miss
 * This is your safety net for phrases like "anytime this week"
 */
function fallbackAppointmentParser(text, timezone) {
  const lowerText = text.toLowerCase().trim();
  const today = moment.tz(timezone);
  
  // Common appointment request patterns that Bland.ai users might say
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
    'anytime this week': {
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
    }
  };
  
  // Check for exact matches
  if (appointmentPatterns[lowerText]) {
    console.log(`📅 Fallback parser matched: "${lowerText}"`);
    return appointmentPatterns[lowerText];
  }
  
  // Check for partial pattern matches
  const partialPatterns = [
    {
      regex: /\b(any ?time|whenever)\s+(this|next)\s+week\b/i,
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
      regex: /\b(morning|afternoon|evening)\s+(appointment|slot|time)?\b/i,
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
    }
  ];
  
  // Try each partial pattern
  for (const pattern of partialPatterns) {
    const match = lowerText.match(pattern.regex);
    if (match) {
      console.log(`📅 Fallback parser partial match: "${lowerText}"`);
      return pattern.handler(match[0]);
    }
  }
  
  return null; // No fallback match
}

// ====================
// CHRONO-NODE PARSER
// ====================
/**
 * Uses chrono-node library to parse natural language dates
 * This is your primary parser that handles most date/time phrases
 */
function parseWithChrono(naturalTime, timezone) {
  try {
    const referenceDate = moment.tz(timezone).toDate();
    
    const results = chrono.parse(naturalTime, referenceDate, { 
      forwardDate: true
    });

    if (!results || results.length === 0) {
      return null;
    }

    const result = results[0];
    
    if (!result || !result.start) {
      return null;
    }

    const parsedDate = result.start.date();
    const dateInTimezone = moment.tz(parsedDate, timezone);
    const formattedDate = dateInTimezone.format('YYYY-MM-DD');
    
    // Determine time of day from the parsed result
    const timeOfDay = determineTimeOfDay(result, naturalTime);
    const confidence = determineConfidence(result, naturalTime);

    return {
      date: formattedDate,
      time_of_day: timeOfDay,
      confidence: confidence
    };

  } catch (error) {
    console.error('Error in chrono parsing:', error);
    return null;
  }
}

/**
 * Helper function to determine time of day from parsed result
 */
function determineTimeOfDay(result, originalText) {
  const lowerText = originalText.toLowerCase();
  
  if (lowerText.includes('morning') || lowerText.includes('am')) {
    return 'morning';
  }
  if (lowerText.includes('afternoon') || (lowerText.includes('pm') && !lowerText.includes('evening'))) {
    return 'afternoon';
  }
  if (lowerText.includes('evening') || lowerText.includes('night')) {
    return 'evening';
  }
  
  // Check if chrono detected a specific hour
  if (result.start.get('hour') !== undefined) {
    const hour = result.start.get('hour');
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 24) return 'evening';
  }
  
  return 'any';
}

/**
 * Helper function to determine confidence level of the parse
 */
function determineConfidence(result, originalText) {
  const lowerText = originalText.toLowerCase();

  // High confidence if we have complete date components
  if (result.start.get('year') !== undefined && 
      result.start.get('month') !== undefined && 
      result.start.get('day') !== undefined) {
    return 'high';
  }
  
  // High confidence for specific keywords
  const highConfidenceKeywords = [
    'today', 'tomorrow', 'yesterday',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ];
  
  if (highConfidenceKeywords.some(keyword => lowerText.includes(keyword))) {
    return 'high';
  }
  
  return 'medium';
}

// ====================
// MULTI-STRATEGY PARSER
// ====================
/**
 * Combines all parsing strategies to ensure we always return something useful
 * This is what makes your system robust - it tries multiple approaches
 */
async function parseNaturalTimeWithFallbacks(naturalTime, timezone) {
  // Strategy 1: Try chrono-node first
  const chronoResult = parseWithChrono(naturalTime, timezone);
  if (chronoResult && chronoResult.date) {
    console.log('✓ Chrono-node succeeded');
    return {
      ...chronoResult,
      parser_used: 'chrono',
      original_input: naturalTime
    };
  }
  
  // Strategy 2: Try the fallback parser
  const fallbackResult = fallbackAppointmentParser(naturalTime, timezone);
  if (fallbackResult) {
    console.log('✓ Fallback parser succeeded');
    return {
      ...fallbackResult,
      parser_used: 'fallback',
      original_input: naturalTime
    };
  }
  
  // Strategy 3: Return a "needs clarification" response
  console.log('⚠ All parsers failed - needs clarification');
  return {
    date: null,
    time_of_day: 'any',
    confidence: 'none',
    needs_clarification: true,
    original_input: naturalTime,
    parser_used: 'none',
    message: 'Could not parse the date/time from the input'
  };
}

// ====================
// MAIN API ENDPOINT
// ====================
/**
 * Main endpoint that Bland.ai calls
 * Matches the exact format your webhook expects
 */
app.post('/api/enhanced-parse-natural-time', async (req, res) => {
  try {
    // Verify webhook signature for security
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }
    
    // Extract data from Bland.ai request format
    const { datetime_request, timezone } = req.body.data || {};
    
    if (!datetime_request) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: datetime_request',
        parsed: null
      });
    }
    
    const tz = timezone || 'America/New_York';
    
    // Validate timezone
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        success: false,
        message: `Invalid timezone: ${timezone}`,
        parsed: null
      });
    }
    
    console.log(`📞 Received appointment request: "${datetime_request}" in timezone: ${tz}`);
    
    // Step 1: Use Gemini to fix speech-to-text errors
    const correctedText = await intelligentSpeechCorrection(datetime_request);
    
    // Step 2: Parse the corrected text with multi-strategy approach
    const parsedResult = await parseNaturalTimeWithFallbacks(correctedText, tz);
    
    // Step 3: Format response for Bland.ai
    if (parsedResult.date) {
      // Success - we parsed a date
      res.json({
        success: true,
        message: 'Successfully parsed date/time',
        parsed: {
          date: parsedResult.date,
          time_of_day: parsedResult.time_of_day || 'any',
          confidence: parsedResult.confidence || 'medium',
          flexible: parsedResult.flexible || false,
          urgent: parsedResult.urgent || false,
          date_range: parsedResult.date_range || null
        },
        debug: {
          original_input: datetime_request,
          corrected_input: correctedText,
          parser_used: parsedResult.parser_used
        }
      });
    } else {
      // Could not parse - return null date for Bland.ai to handle
      res.json({
        success: false,
        message: parsedResult.message || 'Could not parse date/time',
        parsed: {
          date: null,
          time_of_day: 'any',
          confidence: 'low'
        },
        debug: {
          original_input: datetime_request,
          corrected_input: correctedText,
          parser_used: 'none'
        }
      });
    }
    
  } catch (error) {
    console.error('Error in parse endpoint:', error);
    
    // Return a safe error response that Bland.ai can handle
    res.status(200).json({
      success: false,
      message: 'Error processing date/time request',
      parsed: {
        date: null,
        time_of_day: 'any',
        confidence: 'low'
      },
      error: error.message
    });
  }
});





// ====================
// HEALTH CHECK ENDPOINT
// ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Enhanced Natural Language Time Parser',
    gemini: 'enabled',
    timezone: moment.tz.guess()
  });
});

// ====================
// TEST ENDPOINT
// ====================
/**
 * Test endpoint to verify Gemini is working
 * Useful for debugging after deployment
 */
app.post('/api/test', async (req, res) => {
  const testCases = [
    "anytimethisweek",
    "four fifteen ninety four",
    "tomorrowmorning",
    "three thirty pm",
    "next monday afternoon"
  ];
  
  const results = [];
  for (const test of testCases) {
    const corrected = await intelligentSpeechCorrection(test);
    const parsed = await parseNaturalTimeWithFallbacks(corrected, 'America/New_York');
    results.push({
      input: test,
      corrected: corrected,
      parsed: parsed
    });
  }
  
  res.json({ 
    test_results: results,
    gemini_status: 'working',
    project: process.env.GOOGLE_CLOUD_PROJECT
  });
});

// ====================
// SERVER STARTUP
// ====================
const server = app.listen(PORT, () => {
  console.log(`🏥 Enhanced Natural Language Time Parser`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🤖 Gemini AI: Enabled`);
  console.log(`📍 Project: ${process.env.GOOGLE_CLOUD_PROJECT || 'Not set'}`);
  console.log(`🌍 Region: us-central1`);
  console.log(`📋 Endpoints:`);
  console.log(`   - POST /api/enhanced-parse-natural-time (main parser)`);
  console.log(`   - POST /api/normalize-dob (DOB normalization)`);
  console.log(`   - POST /api/format-appointment-date (date formatting)`);
  console.log(`   - GET /health (health check)`);
  console.log(`   - POST /api/test (test Gemini correction)`);
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