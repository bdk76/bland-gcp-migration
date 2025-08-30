const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');
const NodeCache = require('node-cache');
const moment = require('moment-timezone');

// Initialize services
const app = express();
const firestore = new Firestore();
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 300 }); // 1 hour cache for zip codes

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || 
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const firestoreHealthy = await checkFirestoreHealth();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'zipcode-validate',
    cache_entries: cache.keys().length,
    firestore: firestoreHealthy ? 'connected' : 'disconnected'
  });
});

// Warmup endpoint
app.get('/_ah/warmup', async (req, res) => {
  // Pre-load common ZIP codes
  await preloadCommonZipCodes();
  res.status(200).send('OK');
});

// Main ZIP code validation endpoint
app.post('/api/zipcode-validated', async (req, res) => {
  const startTime = Date.now();
  const { requestId } = req;
  
  try {
    const { 
      zip_code,
      text_input,
      text_type,
      date,
      time,
      timezone,
      include_demographics = false
    } = req.body;
    
    console.log(`[${requestId}] ZIP validation request:`, {
      zip_code,
      text_type,
      has_date: !!date
    });
    
    // Handle date formatting if requested
    if (date) {
      const formattedDate = await formatDate(date, time, timezone, requestId);
      return res.json({
        success: true,
        ...formattedDate,
        response_time: Date.now() - startTime
      });
    }
    
    // Handle text normalization if requested
    if (text_input && text_type) {
      const normalizedText = normalizeText(text_input, text_type, requestId);
      return res.json({
        success: true,
        processed_text: normalizedText,
        original_input: text_input,
        text_type: text_type,
        response_time: Date.now() - startTime
      });
    }
    
    // Main ZIP code validation
    if (!zip_code) {
      return res.status(400).json({
        error: 'ZIP code is required',
        success: false,
        data: null
      });
    }
    
    // Clean and validate ZIP code
    const cleanZip = cleanZipCode(zip_code);
    
    if (!isValidZipFormat(cleanZip)) {
      return res.status(400).json({
        error: 'Invalid ZIP code format. Must be 5 digits or ZIP+4 format',
        success: false,
        data: null,
        provided: zip_code,
        cleaned: cleanZip
      });
    }
    
    // Extract 5-digit ZIP
    const zip5 = cleanZip.substring(0, 5);
    
    // Check cache first
    const cacheKey = `zip:${zip5}:${include_demographics}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`[${requestId}] Cache hit for ZIP ${zip5}`);
      return res.json({
        success: true,
        data: cachedData,
        zip_code: zip5,
        cached: true,
        response_time: Date.now() - startTime
      });
    }
    
    // Lookup ZIP code data
    const zipData = await lookupZipCode(zip5, include_demographics, requestId);
    
    if (!zipData) {
      console.log(`[${requestId}] No data found for ZIP ${zip5}`);
      // Return soft error for Bland.ai flow
      return res.status(200).json({
        success: false,
        data: null,
        zip_code: zip5,
        needs_state: true,
        message: 'Unable to find location data for this ZIP code. Please provide state directly.',
        response_time: Date.now() - startTime
      });
    }
    
    // Cache successful lookup
    cache.set(cacheKey, zipData);
    
    // Log lookup for analytics (async, non-blocking)
    logZipLookup(requestId, zip5, zipData).catch(err =>
      console.error(`[${requestId}] Failed to log lookup:`, err)
    );
    
    res.json({
      success: true,
      data: zipData,
      zip_code: zip5,
      source: 'firestore',
      response_time: Date.now() - startTime
    });
    
  } catch (error) {
    console.error(`[${requestId}] ZIP validation error:`, error);
    res.status(500).json({
      error: 'Failed to process ZIP code',
      message: error.message,
      success: false,
      requestId,
      response_time: Date.now() - startTime
    });
  }
});

// Helper Functions

function cleanZipCode(zipCode) {
  if (!zipCode) return '';
  
  // Convert to string and remove all non-digits
  let cleaned = String(zipCode).replace(/\D/g, '');
  
  // Handle common speech patterns (e.g., "zero seven one zero three" -> "07103")
  if (cleaned.length === 0 && zipCode.toLowerCase().includes('zero')) {
    cleaned = zipCode.toLowerCase()
      .replace(/zero/g, '0')
      .replace(/one/g, '1')
      .replace(/two/g, '2')
      .replace(/three/g, '3')
      .replace(/four/g, '4')
      .replace(/five/g, '5')
      .replace(/six/g, '6')
      .replace(/seven/g, '7')
      .replace(/eight/g, '8')
      .replace(/nine/g, '9')
      .replace(/\D/g, '');
  }
  
  return cleaned;
}

function isValidZipFormat(zip) {
  // Valid formats: 5 digits or 9 digits (ZIP+4)
  return /^\d{5}$/.test(zip) || /^\d{9}$/.test(zip);
}

async function lookupZipCode(zip5, includeDemographics, requestId) {
  console.log(`[${requestId}] Looking up ZIP ${zip5}`);
  
  try {
    // TODO: MIGRATION POINT - Replace with Firestore collection
    // This will query the migrated ZIP codes collection
    const zipRef = firestore.collection('zip_codes').doc(zip5);
    const doc = await zipRef.get();
    
    if (!doc.exists) {
      // Fallback to known mappings (temporary during migration)
      return getFallbackZipData(zip5);
    }
    
    const data = doc.data();
    
    const result = {
      city: data.city || data.City,
      state: data.state || data.State,
      state_abbreviation: data.state_abbreviation || data.State_Abbreviation,
      county: data.county || data.County,
      timezone: data.timezone || data.time_zone || getTimezoneFromState(data.state_abbreviation),
      latitude: data.latitude || data.lat,
      longitude: data.longitude || data.lng,
      area_code: data.area_code
    };
    
    // Add demographics if requested
    if (includeDemographics && data.demographics) {
      result.demographics = {
        population: data.demographics.population,
        median_income: data.demographics.median_income,
        median_age: data.demographics.median_age
      };
    }
    
    return result;
    
  } catch (error) {
    console.error(`[${requestId}] Firestore lookup failed:`, error);
    // Fallback to known mappings
    return getFallbackZipData(zip5);
  }
}

function getFallbackZipData(zip5) {
  // Temporary fallback data during migration
  const fallbackData = {
    '07103': {
      city: 'Newark',
      state: 'New Jersey',
      state_abbreviation: 'NJ',
      timezone: 'America/New_York'
    },
    '07458': {
      city: 'Saddle River',
      state: 'New Jersey',
      state_abbreviation: 'NJ',
      timezone: 'America/New_York'
    },
    '10001': {
      city: 'New York',
      state: 'New York',
      state_abbreviation: 'NY',
      timezone: 'America/New_York'
    },
    '90210': {
      city: 'Beverly Hills',
      state: 'California',
      state_abbreviation: 'CA',
      timezone: 'America/Los_Angeles'
    },
    '33101': {
      city: 'Miami',
      state: 'Florida',
      state_abbreviation: 'FL',
      timezone: 'America/New_York'
    },
    '60601': {
      city: 'Chicago',
      state: 'Illinois',
      state_abbreviation: 'IL',
      timezone: 'America/Chicago'
    }
  };
  
  return fallbackData[zip5] || null;
}

function normalizeText(input, type, requestId) {
  if (!input) return '';
  
  console.log(`[${requestId}] Normalizing ${type}: "${input}"`);
  
  let processed = input.toString().trim();
  
  switch (type) {
    case 'street_name':
      return normalizeStreetName(processed);
    case 'email':
      return normalizeEmail(processed);
    case 'name':
      return normalizeName(processed);
    case 'phone':
      return normalizePhone(processed);
    default:
      return processed;
  }
}

function normalizeStreetName(input) {
  // Handle camelCase splitting (e.g., "CarrAvenue" -> "Carr Avenue")
  let normalized = input.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Normalize spaces
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Street type mappings
  const streetTypes = {
    'Ave': 'Avenue', 'St': 'Street', 'Rd': 'Road', 'Dr': 'Drive',
    'Ln': 'Lane', 'Blvd': 'Boulevard', 'Ct': 'Court', 'Pl': 'Place',
    'Cir': 'Circle', 'Ter': 'Terrace', 'Hwy': 'Highway', 'Pkwy': 'Parkway'
  };
  
  // Direction mappings
  const directions = {
    'N': 'North', 'S': 'South', 'E': 'East', 'W': 'West',
    'NE': 'Northeast', 'NW': 'Northwest', 'SE': 'Southeast', 'SW': 'Southwest'
  };
  
  const words = normalized.split(' ');
  const processedWords = words.map(word => {
    const cleanWord = word.trim();
    if (!cleanWord) return '';
    
    // Check for street type
    if (streetTypes[cleanWord]) {
      return streetTypes[cleanWord];
    }
    
    // Check for direction
    if (directions[cleanWord.toUpperCase()]) {
      return directions[cleanWord.toUpperCase()];
    }
    
    // Capitalize first letter
    return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
  });
  
  return processedWords.filter(word => word).join(' ');
}

function normalizeEmail(input) {
  let cleaned = input.toLowerCase().replace(/\s+/g, '');
  
  // Handle speech patterns
  const patterns = {
    'atgmaildotcom': '@gmail.com',
    'atyahoodotcom': '@yahoo.com',
    'athotmaildotcom': '@hotmail.com',
    'atoutlookdotcom': '@outlook.com'
  };
  
  for (const [pattern, replacement] of Object.entries(patterns)) {
    cleaned = cleaned.replace(new RegExp(pattern, 'g'), replacement);
  }
  
  // General replacements
  if (!cleaned.includes('@')) {
    cleaned = cleaned.replace(/at/g, '@');
  }
  if (!cleaned.includes('.')) {
    cleaned = cleaned.replace(/dot/g, '.');
  }
  
  return cleaned;
}

function normalizeName(input) {
  const words = input.replace(/\s+/g, ' ').split(' ');
  return words.map(word => {
    const clean = word.trim();
    if (!clean) return '';
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }).filter(word => word).join(' ');
}

function normalizePhone(input) {
  // Remove all non-digits
  const digits = input.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX if 10 digits
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  // Format as +X (XXX) XXX-XXXX if 11 digits starting with 1
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return digits;
}

async function formatDate(date, time, timezone = 'America/New_York', requestId) {
  console.log(`[${requestId}] Formatting date: ${date} ${time} ${timezone}`);
  
  try {
    const appointmentDate = moment.tz(date, timezone);
    
    if (!appointmentDate.isValid()) {
      throw new Error('Invalid date format');
    }
    
    // Format date naturally
    const formattedDate = appointmentDate.format('dddd, MMMM Do');
    
    // Format time if provided
    let formattedTime = '';
    if (time) {
      const timeMoment = moment.tz(`${date} ${time}`, timezone);
      if (timeMoment.isValid()) {
        const minutes = timeMoment.minutes();
        formattedTime = minutes === 0 ? 
          timeMoment.format('h A') : 
          timeMoment.format('h:mm A');
      }
    }
    
    // Create confirmation text
    let confirmationText = `Your appointment is confirmed for ${formattedDate}`;
    if (formattedTime) {
      confirmationText += ` at ${formattedTime}`;
    }
    
    return {
      formatted_date: formattedDate,
      formatted_time: formattedTime,
      confirmation_text: confirmationText,
      day_name: appointmentDate.format('dddd'),
      month_name: appointmentDate.format('MMMM'),
      day_number: appointmentDate.format('Do'),
      year: appointmentDate.format('YYYY')
    };
    
  } catch (error) {
    console.error(`[${requestId}] Date formatting error:`, error);
    throw error;
  }
}

function getTimezoneFromState(stateAbbr) {
  const timezones = {
    'NY': 'America/New_York', 'CA': 'America/Los_Angeles', 'TX': 'America/Chicago',
    'FL': 'America/New_York', 'IL': 'America/Chicago', 'PA': 'America/New_York',
    'AZ': 'America/Phoenix', 'HI': 'Pacific/Honolulu', 'AK': 'America/Anchorage'
    // Add more as needed
  };
  
  return timezones[stateAbbr] || 'America/New_York';
}

async function preloadCommonZipCodes() {
  // Pre-load frequently used ZIP codes
  const commonZips = ['10001', '90210', '60601', '33101', '94102'];
  
  for (const zip of commonZips) {
    try {
      const data = await lookupZipCode(zip, false, 'preload');
      if (data) {
        cache.set(`zip:${zip}:false`, data);
      }
    } catch (error) {
      console.error(`Failed to preload ZIP ${zip}:`, error);
    }
  }
  
  console.log(`Preloaded ${commonZips.length} common ZIP codes`);
}

async function checkFirestoreHealth() {
  try {
    const doc = await firestore.collection('_health').doc('check').get();
    return true;
  } catch (error) {
    return false;
  }
}

async function logZipLookup(requestId, zip, data) {
  // Log for analytics
  const logData = {
    requestId,
    timestamp: new Date(),
    zip_code: zip,
    state: data?.state_abbreviation,
    success: !!data
  };
  
  console.log(`[${requestId}] ZIP lookup logged:`, logData);
}

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`ZIP code validation service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  
  // Pre-warm cache with common ZIPs
  preloadCommonZipCodes().catch(console.error);
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