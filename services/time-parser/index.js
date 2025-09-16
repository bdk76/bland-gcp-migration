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

// Middleware setup
app.use(cors());
app.use(bodyParser.json());

// ====================
// GEMINI AI CONFIGURATION
// ====================
const vertex_ai = new VertexAI({
  project: 'bland-gcp-migration',
  location: 'us-central1'
});
const geminiModel = vertex_ai.preview.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    maxOutputTokens: 256,
    temperature: 0.1,
    topP: 0.8,
    topK: 40,
  },
});

// ====================
// GEMINI INTELLIGENT CORRECTION
// ====================
async function intelligentSpeechCorrection(garbledText) {
  if (!garbledText || garbledText.length < 2) return garbledText;
  try {
    console.log(`🔧 Gemini fixing garbled text: "${garbledText}"`);
    const prompt = `You are fixing speech-to-text errors for medical appointment scheduling.
    
CRITICAL RULES FOR CORRECTION:
1. Words often stick together: "anytimethisweek" → "any time this week"
2. Numbers are spelled out: "four fifteen ninety four" → "4/15/94"
3. Times are spelled: "three thirty pm" → "3:30 pm"
4. Days run together: "nextmonday" → "next monday"
5. Common phrases: "tomorrowmorning" → "tomorrow morning"

Input text: "${garbledText}"

Output ONLY the corrected text with proper spacing and numbers. Do not add any explanation or change the meaning. Preserve the exact intent for medical scheduling.`;
    const request = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    const response = await geminiModel.generateContent(request);
    const correctedText = response.response.candidates[0].content.parts[0].text.trim();
    console.log(`✅ Gemini corrected to: "${correctedText}"`);
    return correctedText;
  } catch (error) {
    console.error('❌ Gemini correction failed, using original:', error.message);
    return garbledText;
  }
}

// ====================
// PARSING LOGIC
// ====================
function parseNaturalTimeWithFallbacks(naturalTime, timezone) {
  const chronoResult = chrono.parseDate(naturalTime, { timezone });
  if (chronoResult) {
    return { date: chronoResult, parser_used: 'chrono' };
  }
  // Add more fallback logic here if needed
  return { date: null, parser_used: 'none' };
}

// ====================
// MAIN API ENDPOINT
// ====================
app.post('/api/enhanced-parse-natural-time', async (req, res) => {
  try {
    const { datetime_request, timezone } = req.body.data || {};
    if (!datetime_request) {
      return res.status(400).json({ success: false, message: 'Missing datetime_request' });
    }
    const tz = timezone || 'America/New_York';
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({ success: false, message: `Invalid timezone: ${timezone}` });
    }

    const correctedText = await intelligentSpeechCorrection(datetime_request);
    const parsedResult = parseNaturalTimeWithFallbacks(correctedText, tz);

    if (parsedResult.date) {
      res.json({
        success: true,
        parsed: {
          date: moment(parsedResult.date).format('YYYY-MM-DD'),
          time_of_day: 'any' // Placeholder
        },
        debug: { original_input: datetime_request, corrected_input: correctedText, parser_used: parsedResult.parser_used }
      });
    } else {
      res.status(422).json({ success: false, message: 'Could not parse date', debug: { original_input: datetime_request, corrected_input: correctedText } });
    }
  } catch (error) {
    console.error('Error in parse endpoint:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ====================
// HEALTH & TEST ENDPOINTS
// ====================
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'time-parser' }));
app.post('/api/test', async (req, res) => {
  const testCases = ["anytimethisweek", "tomorrowmorning", "next monday afternoon"];
  const results = [];
  for (const test of testCases) {
    const corrected = await intelligentSpeechCorrection(test);
    const parsed = parseNaturalTimeWithFallbacks(corrected, 'America/New_York');
    results.push({ input: test, corrected: corrected, parsed: parsed.date });
  }
  res.json({ test_results: results });
});

// ====================
// SERVER STARTUP
// ====================
app.listen(PORT, () => {
  console.log(`Time Parser service running on port ${PORT}`);
});

module.exports = app;