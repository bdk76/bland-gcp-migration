const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');
const NodeCache = require('node-cache');
const pLimit = require('p-limit');
const moment = require('moment-timezone');

// Initialize services
const app = express();
const firestore = new Firestore();
const pubsub = new PubSub();
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min cache, check every 60s

// Concurrency limiter for parallel operations
const limit = pLimit(10); // Max 10 concurrent operations

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/*' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || 
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
  try {
    // Check Firestore connectivity
    const firestoreHealthy = await checkFirestoreHealth();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'availability',
      version: process.env.SERVICE_VERSION || '1.0.0',
      dependencies: {
        firestore: firestoreHealthy ? 'connected' : 'disconnected',
        cache: {
          keys: cache.keys().length,
          stats: cache.getStats()
        }
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Warm-up endpoint for Cloud Run
app.get('/_ah/warmup', (req, res) => {
  // Pre-warm caches and connections
  cache.set('warmup', true, 10);
  res.status(200).send('OK');
});

// Main availability endpoint
app.post('/api/available-slots', async (req, res) => {
  const startTime = Date.now();
  const { requestId } = req;
  
  try {
    console.log(`[${requestId}] Processing availability request`);
    
    // Parse and validate request body
    const body = await parseRequestBody(req);
    
    // Log request for debugging
    logRequest(requestId, body);
    
    // Extract and normalize input parameters
    const params = await normalizeRequestParams(body, requestId);
    
    // Check for missing state requirement
    if (!params.patientState) {
      return res.status(200).json({
        available_slots: [],
        has_slots: false,
        total_slots: 0,
        needs_state: true,
        message: 'Patient state is required to check provider licensing',
        suggestion: 'Please capture state from ZIP code and retry'
      });
    }
    
    // Generate cache key
    const cacheKey = generateCacheKey(params);
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult && !body.bypass_cache) {
      console.log(`[${requestId}] Cache hit for key: ${cacheKey}`);
      return res.json({
        ...cachedResult,
        cached: true,
        response_time: Date.now() - startTime
      });
    }
    
    // Fetch availability from Firestore (replacing Airtable)
    const slots = await fetchAvailabilityFromFirestore(params, requestId);
    
    // Build response
    const response = {
      available_slots: slots,
      has_slots: slots.length > 0,
      total_slots: slots.length,
      caller_timezone: params.timezone,
      patient_state: params.patientState,
      dates_checked: params.datesToCheck,
      is_multi_day: params.isMultiDay,
      request_type: params.requestType,
      response_time: Date.now() - startTime
    };
    
    // Cache successful response
    if (slots.length > 0) {
      cache.set(cacheKey, response);
    }
    
    // Async publish metrics (non-blocking)
    publishMetrics(requestId, response, startTime).catch(err => 
      console.error(`[${requestId}] Failed to publish metrics:`, err)
    );
    
    res.json(response);
    
  } catch (error) {
    console.error(`[${requestId}] Error processing request:`, error);
    
    // Return graceful error response
    res.status(500).json({
      error: 'Failed to fetch available slots',
      message: error.message,
      requestId,
      response_time: Date.now() - startTime
    });
  }
});

// Helper Functions

async function parseRequestBody(req) {
  // Handle various content types and Bland.ai template placeholders
  let body = {};
  
  if (typeof req.body === 'object' && req.body !== null) {
    body = req.body;
  } else if (typeof req.body === 'string') {
    let raw = req.body;
    // Replace Mustache-style placeholders with null to keep JSON valid
    raw = raw.replace(/\{\{[^}]*\}\}/g, 'null');
    try {
      body = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse body:', e.message);
      body = {};
    }
  }
  
  return body;
}

function logRequest(requestId, body) {
  // Structured logging for Cloud Logging
  console.log(JSON.stringify({
    severity: 'INFO',
    requestId,
    message: 'Availability request received',
    labels: {
      service: 'availability',
      environment: process.env.ENVIRONMENT || 'production'
    },
    payload: {
      patient_state: body.patient_state,
      patient_zipcode: body.patient_zipcode,
      date: body.date,
      is_multi_day: body.is_multi_day,
      time_of_day: body.time_of_day
    }
  }));
}

async function normalizeRequestParams(body, requestId) {
  const {
    date,
    days_to_check,
    is_multi_day,
    request_type = 'specific',
    time_of_day = 'any',
    time_window,
    time_filter,
    patient_state,
    auto_state,
    auto_state_abbreviation,
    patient_zipcode,
    patient_timezone
  } = body;
  
  // Resolve patient state with fallback logic
  let actualPatientState = await resolvePatientState(
    patient_state,
    auto_state,
    auto_state_abbreviation,
    patient_zipcode,
    requestId
  );
  
  // Normalize boolean values
  const isMultiDay = toBoolean(is_multi_day);
  
  // Normalize days array
  const normalizedDays = normalizeDaysArray(days_to_check);
  
  // Determine dates to check
  let datesToCheck = [date];
  if (isMultiDay && normalizedDays && normalizedDays.length > 0) {
    datesToCheck = normalizedDays;
  }
  
  // Get timezone
  const timezone = patient_timezone || getTimezoneFromState(actualPatientState);
  
  return {
    date,
    datesToCheck,
    isMultiDay,
    requestType,
    timeOfDay: time_of_day,
    timeWindow: normalizeObject(time_window),
    timeFilter: normalizeObject(time_filter),
    patientState: actualPatientState,
    patientZipcode: patient_zipcode,
    timezone
  };
}

async function resolvePatientState(patient_state, auto_state, auto_state_abbreviation, patient_zipcode, requestId) {
  // Check if value is a template placeholder
  const isTemplatePlaceholder = (val) => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    return trimmed.includes('{{') || trimmed.includes('}}') || 
           ['any', 'null', 'undefined'].includes(trimmed.toLowerCase());
  };
  
  // Try patient_state first
  if (patient_state && !isTemplatePlaceholder(patient_state)) {
    return patient_state;
  }
  
  // Try auto_state
  if (auto_state && !isTemplatePlaceholder(auto_state)) {
    console.log(`[${requestId}] Using auto_state as fallback: ${auto_state}`);
    return auto_state;
  }
  
  // Try auto_state_abbreviation
  if (auto_state_abbreviation && !isTemplatePlaceholder(auto_state_abbreviation)) {
    console.log(`[${requestId}] Using auto_state_abbreviation as fallback: ${auto_state_abbreviation}`);
    return auto_state_abbreviation.trim().toUpperCase();
  }
  
  // Try deriving from ZIP code
  if (patient_zipcode) {
    try {
      const derived = await deriveStateFromZip(patient_zipcode, requestId);
      if (derived) {
        console.log(`[${requestId}] Derived state from ZIP ${patient_zipcode}: ${derived}`);
        return derived;
      }
    } catch (error) {
      console.error(`[${requestId}] Failed to derive state from ZIP:`, error);
    }
  }
  
  return null;
}

async function deriveStateFromZip(zipCode, requestId) {
  const cleanZip = String(zipCode).replace(/\D/g, '').substring(0, 5);
  
  if (cleanZip.length !== 5) {
    return null;
  }
  
  // Check cache first
  const cacheKey = `zip:${cleanZip}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached.state_abbreviation || cached.state;
  }
  
  try {
    // TODO: MIGRATION POINT - Replace with Firestore lookup when migrating from Airtable
    // Query Firestore for ZIP code data
    const zipRef = firestore.collection('zip_codes').doc(cleanZip);
    const doc = await zipRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      const state = data.state_abbreviation || data.state;
      cache.set(cacheKey, { state_abbreviation: state }, 3600);
      return state;
    }
    
    // Fallback to static mapping during migration
    const fallbackMap = {
      '10001': 'NY', '90210': 'CA', '60601': 'IL', '33101': 'FL'
    };
    return fallbackMap[cleanZip] || null;
    
  } catch (error) {
    console.error(`[${requestId}] ZIP lookup failed:`, error);
    return null;
  }
}

async function fetchAvailabilityFromFirestore(params, requestId) {
  const { datesToCheck, patientState, timeOfDay, timeWindow, timeFilter, timezone } = params;
  
  console.log(`[${requestId}] Fetching availability for ${datesToCheck.length} dates in ${patientState}`);
  
  // Sort dates and create range
  const sortedDates = [...new Set(datesToCheck)].sort();
  const rangeStart = sortedDates[0];
  const rangeEnd = sortedDates[sortedDates.length - 1];
  
  try {
    // TODO: MIGRATION POINT - This replaces Airtable query
    // Using Firestore collection 'MVP-Availability-Dashboard' as mentioned
    const availabilityRef = firestore.collection('MVP-Availability-Dashboard');
    
    // Build query with proper indexing
    let query = availabilityRef
      .where('scheduled_available', '==', true)
      .where('scheduled_state', 'in', [
        getStateAbbreviation(patientState),
        getFullStateName(patientState)
      ])
      .where('scheduled_date', '>=', rangeStart)
      .where('scheduled_date', '<=', rangeEnd)
      .orderBy('scheduled_date', 'asc')
      .limit(500); // Reasonable limit for performance
    
    // Execute query with retry logic
    const snapshot = await executeWithRetry(() => query.get(), requestId);
    
    if (snapshot.empty) {
      console.log(`[${requestId}] No slots found for criteria`);
      return [];
    }
    
    // Process slots in parallel with concurrency control
    const slots = [];
    const processPromises = snapshot.docs.map(doc => 
      limit(async () => {
        const data = doc.data();
        const processedSlots = processSlotData(data, timeOfDay, timeWindow, timeFilter, timezone);
        slots.push(...processedSlots);
      })
    );
    
    await Promise.all(processPromises);
    
    // Sort by date and time
    slots.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.natural_time.localeCompare(b.natural_time);
    });
    
    console.log(`[${requestId}] Found ${slots.length} available slots`);
    return slots;
    
  } catch (error) {
    console.error(`[${requestId}] Firestore query failed:`, error);
    throw error;
  }
}

function processSlotData(data, timeOfDay, timeWindow, timeFilter, timezone) {
  const slots = [];
  const timeSlots = Array.isArray(data.scheduled_time_slot) ? data.scheduled_time_slot : [];
  
  for (const slot of timeSlots) {
    // Extract start time from slot label (e.g., "9:00 AM - 9:15 AM")
    const startTime = extractStartTime(slot);
    const minutes = timeToMinutes(startTime);
    
    // Apply time filters
    if (!isTimeWithinPreference(minutes, timeOfDay, timeWindow, timeFilter)) {
      continue;
    }
    
    slots.push({
      date: data.scheduled_date,
      day_name: getDayName(data.scheduled_date),
      time_slot: slot,
      natural_time: startTime,
      provider: data.scheduled_provider || '',
      provider_type: data.provider_type || '',
      appointment_type: data.appointment_type || '',
      provider_id: data.athena_provider_id || '',
      appointment_id: data.athena_appointment_id || '',
      caller_timezone: timezone
    });
  }
  
  return slots;
}

function extractStartTime(timeSlot) {
  // Extract start time from slot format "9:00 AM - 9:15 AM"
  const parts = String(timeSlot).split('-');
  return parts[0] ? parts[0].trim() : timeSlot;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  
  const cleaned = String(timeStr).toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const isPM = match[3] === 'PM';
  
  if (hours === 12) hours = 0;
  const totalMinutes = (hours + (isPM ? 12 : 0)) * 60 + minutes;
  
  return totalMinutes;
}

function isTimeWithinPreference(minutes, timeOfDay, timeWindow, timeFilter) {
  if (minutes === null) return true;
  
  // Time of day windows
  const todWindows = {
    morning: { start: 8 * 60, end: 12 * 60 - 1 },
    afternoon: { start: 12 * 60, end: 17 * 60 - 1 },
    evening: { start: 17 * 60, end: 21 * 60 - 1 },
    night: { start: 21 * 60, end: 23 * 60 },
    midday: { start: 12 * 60, end: 12 * 60 }
  };
  
  // Apply time window preference
  let windowToUse = null;
  if (timeWindow && Number.isFinite(timeWindow.start) && Number.isFinite(timeWindow.end)) {
    windowToUse = timeWindow;
  } else if (timeOfDay && todWindows[timeOfDay]) {
    windowToUse = todWindows[timeOfDay];
  }
  
  if (windowToUse) {
    if (minutes < windowToUse.start || minutes > windowToUse.end) return false;
  }
  
  // Apply time filter
  if (timeFilter && timeFilter.type) {
    switch (timeFilter.type) {
      case 'after':
        return minutes >= timeFilter.start;
      case 'before':
        return minutes <= timeFilter.end;
      case 'between':
        return minutes >= timeFilter.start && minutes <= timeFilter.end;
      case 'around':
        const tolerance = timeFilter.tolerance || 30;
        return Math.abs(minutes - timeFilter.exact) <= tolerance;
    }
  }
  
  return true;
}

function generateCacheKey(params) {
  // Generate deterministic cache key
  const components = [
    params.patientState,
    params.datesToCheck.join(','),
    params.timeOfDay,
    JSON.stringify(params.timeWindow),
    JSON.stringify(params.timeFilter)
  ];
  
  return `slots:${components.join(':')}`;
}

async function executeWithRetry(operation, requestId, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(`[${requestId}] Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

async function publishMetrics(requestId, response, startTime) {
  // Publish metrics to Pub/Sub for monitoring
  const metrics = {
    requestId,
    service: 'availability',
    timestamp: new Date().toISOString(),
    response_time_ms: Date.now() - startTime,
    slots_found: response.total_slots,
    cache_hit: response.cached || false,
    patient_state: response.patient_state,
    dates_checked: response.dates_checked.length
  };
  
  const topic = pubsub.topic(process.env.METRICS_TOPIC || 'service-metrics');
  const messageBuffer = Buffer.from(JSON.stringify(metrics));
  
  await topic.publish(messageBuffer);
}

async function checkFirestoreHealth() {
  try {
    // Simple health check query
    const doc = await firestore.collection('_health').doc('check').get();
    return true;
  } catch (error) {
    console.error('Firestore health check failed:', error);
    return false;
  }
}

// Utility functions (preserved from original)

function toBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function normalizeDaysArray(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      // Continue to CSV parsing
    }
    const trimmed = val.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return null;
    const parts = trimmed
      .split(/\s*,\s*/)
      .map(s => s.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return null;
}

function normalizeObject(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function getDayName(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function getStateAbbreviation(stateName) {
  const stateMap = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC'
  };
  
  const normalizedState = stateName.trim();
  const abbreviation = stateMap[normalizedState] || stateMap[normalizedState.toUpperCase()] || normalizedState.toUpperCase();
  
  return abbreviation;
}

function getFullStateName(stateOrAbbrev) {
  const map = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
  };
  
  if (!stateOrAbbrev || typeof stateOrAbbrev !== 'string') return null;
  const trimmed = stateOrAbbrev.trim();
  return map[trimmed.toUpperCase()] || trimmed;
}

function getTimezoneFromState(state, patientTimezone = null) {
  if (patientTimezone) return patientTimezone;
  
  const stateTimezoneMap = {
    'NY': 'America/New_York', 'CA': 'America/Los_Angeles', 'TX': 'America/Chicago',
    'FL': 'America/New_York', 'IL': 'America/Chicago', 'PA': 'America/New_York',
    'OH': 'America/New_York', 'GA': 'America/New_York', 'NC': 'America/New_York',
    'MI': 'America/New_York', 'NJ': 'America/New_York', 'VA': 'America/New_York',
    'WA': 'America/Los_Angeles', 'AZ': 'America/Phoenix', 'MA': 'America/New_York',
    'TN': 'America/Chicago', 'IN': 'America/New_York', 'MO': 'America/Chicago',
    'MD': 'America/New_York', 'WI': 'America/Chicago', 'CO': 'America/Denver',
    'MN': 'America/Chicago', 'SC': 'America/New_York', 'AL': 'America/Chicago',
    'LA': 'America/Chicago', 'KY': 'America/New_York', 'OR': 'America/Los_Angeles',
    'OK': 'America/Chicago', 'CT': 'America/New_York', 'UT': 'America/Denver',
    'IA': 'America/Chicago', 'NV': 'America/Los_Angeles', 'AR': 'America/Chicago',
    'MS': 'America/Chicago', 'KS': 'America/Chicago', 'NM': 'America/Denver',
    'NE': 'America/Chicago', 'WV': 'America/New_York', 'ID': 'America/Denver',
    'HI': 'Pacific/Honolulu', 'NH': 'America/New_York', 'ME': 'America/New_York',
    'RI': 'America/New_York', 'MT': 'America/Denver', 'DE': 'America/New_York',
    'SD': 'America/Chicago', 'ND': 'America/Chicago', 'AK': 'America/Anchorage',
    'VT': 'America/New_York', 'WY': 'America/Denver', 'DC': 'America/New_York'
  };
  
  const abbreviation = getStateAbbreviation(state);
  return stateTimezoneMap[abbreviation] || 'America/New_York';
}

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`Availability service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.ENVIRONMENT || 'production'}`);
  console.log(`Service version: ${process.env.SERVICE_VERSION || '1.0.0'}`);
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