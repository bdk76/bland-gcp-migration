/**
 * Webhook 1: ZIP Code Lookup + Availability Summary
 *
 * Responsibilities:
 * - Validate ZIP and return city, state, state_abbreviation, timezone
 * - Count upcoming available appointment days for the caller's state
 * - If <= 3 days have availability, return up to 2 slots (morning/afternoon) per day
 * - Provide fields used by Bland flow branching and prompts
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const crypto = require('crypto');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Initialize Firestore
// Both ZIP codes and availability data are in the MVP project
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID || 'bland-gcp-migration'
});

// Webhook secret
const WEBHOOK_SECRET = process.env.BLAND_WEBHOOK_SECRET || '';
const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

function verifyBlandWebhook(payload, signature) {
  if (SKIP_SIGNATURE) return true;
  if (!WEBHOOK_SECRET) return true;
  const expectedSignature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return signature === expectedSignature;
}

async function lookupZip(zipCode) {
  if (!zipCode) return null;

  // ZIP data is in zip_code_database collection in MVP project
  const collectionsToTry = ['zip_code_database'];
  console.log(`[zip-lookup] Using projectId=${process.env.GCP_PROJECT_ID} for ZIP lookup, collection=zip_code_database`);
  for (const col of collectionsToTry) {
    const docRef = firestore.collection(col).doc(String(zipCode));
    try {
      const doc = await docRef.get();
      if (doc.exists) {
        const d = doc.data();
        console.log(`[zip-lookup] Found ZIP ${zipCode} in collection '${col}' -> ${d.city || d.placeName || d.City || 'unknown'}, ${d.state || d.State || d.state_name || d.stateAbbr || d.state_code || d.StateCode || 'unknown'}`);
        return {
          zip_code: String(zipCode),
          city: d.city || d.placeName || d.City || null,
          state: d.state || d.State || d.state_name || null,
          state_abbreviation: d.state_abbreviation || d.stateAbbr || d.state_code || d.StateCode || null,
          timezone: d.timezone || d.tz || d.time_zone || 'America/New_York'
        };
      }
    } catch (err) {
      console.log(`[zip-lookup] Error checking collection '${col}': ${err.message}`);
    }
  }
  return null;
}

function pickDayPartsSlots(slotsForDay) {
  // Select at most 2: one morning and one afternoon if possible; else earliest two
  const parsed = slotsForDay.map(s => {
    const startPart = (s.time || s.scheduledTimeSlot || '').split('-')[0].trim();
    const start = moment(startPart, ['h:mm A', 'H:mm']);
    return { raw: s, startPart, start };
  }).sort((a, b) => a.start.valueOf() - b.start.valueOf());

  const morning = parsed.find(p => p.start.isValid() && p.start.hour() < 12);
  const afternoon = parsed.find(p => p.start.isValid() && p.start.hour() >= 12);

  const selected = [];
  if (morning) selected.push(morning);
  if (afternoon && afternoon !== morning) selected.push(afternoon);
  if (selected.length < 2) {
    for (const p of parsed) {
      if (!selected.includes(p)) selected.push(p);
      if (selected.length === 2) break;
    }
  }
  return selected.map(p => ({ startPart: p.startPart, raw: p.raw }));
}

async function summarizeAvailabilityByState(state, stateAbbr, timezone) {
  const today = new Date().toISOString().split('T')[0];
  const stateValues = [state, stateAbbr, state?.toUpperCase(), stateAbbr?.toUpperCase()].filter(Boolean);
  console.log(`[availability] projectId=${process.env.GCP_PROJECT_ID} statesTried=${stateValues.join(',')} fromDate=${today}`);

  let allSlots = [];
  for (const s of stateValues) {
    console.log(`[availability] Trying stateValue='${s}'`);
    const q = await firestore
      .collection('doctor_scheduling')
      .where('scheduledState', '==', s)
      .where('scheduledAvailable', '==', true)
      .where('scheduledDate', '>=', today)
      .limit(500)
      .get();
    if (!q.empty) {
      console.log(`[availability] Matched ${q.size} docs for state='${s}'`);
      q.forEach(doc => {
        const data = doc.data();
        allSlots.push({ id: doc.id, ...data });
      });
      break;
    }
  }

  // Group by date
  const byDate = allSlots.reduce((map, s) => {
    const d = s.scheduledDate;
    if (!d) return map;
    if (!map[d]) map[d] = [];
    map[d].push(s);
    return map;
  }, {});

  const uniqueDates = Object.keys(byDate).sort();
  const daysAvailable = uniqueDates.length;

  // If 3 or fewer days, build up to 2 slots per day
  let availableSlots = [];
  if (daysAvailable > 0 && daysAvailable <= 3) {
    for (const date of uniqueDates) {
      const picked = pickDayPartsSlots(byDate[date]);
      for (const p of picked) {
        const startPart = p.startPart;
        const slotMoment = moment.tz(`${date} ${startPart}`, 'YYYY-MM-DD h:mm A', timezone);
        availableSlots.push({
          date: date,
          time: p.raw.scheduledTimeSlot,
          time_slot: p.raw.scheduledTimeSlot,
          natural_time: startPart,
          formatted_datetime: slotMoment.format('MMMM DD, YYYY [at] h:mm A'),
          day_of_week: slotMoment.format('dddd'),
          day_name: slotMoment.format('dddd'),
          provider: p.raw.scheduledProvider || null,
          provider_id: p.raw.scheduledProviderId || p.raw.provider_id || null,
          appointment_id: p.raw.athenaAppointmentId || p.raw.appointment_id || null,
          location: p.raw.location || null,
          type: p.raw.type || p.raw.visitType || null,
          slot_id: p.raw.id || p.raw.slot_id || null
        });
      }
    }
  }

  return {
    totalAppointments: allSlots.length,
    daysAvailable: daysAvailable,
    availableSlots: availableSlots
  };
}

// Fallback logic has been removed to ensure the service is fully dynamic.

app.post('/webhook/zipcode-availability', async (req, res) => {
  const requestId = Date.now();
  try {
    const signature = req.headers['x-bland-signature'];
    const payload = JSON.stringify(req.body);
    if (!verifyBlandWebhook(payload, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const { action, data = {} } = req.body || {};
    const zipCode = (data.zip_code || data.zipCode || '').toString().trim();

    if (action !== 'validate_zipcode') {
      return res.status(400).json({ error: 'Unsupported action', message: 'Use action=validate_zipcode' });
    }

    const zipInfo = await lookupZip(zipCode);
    if (!zipInfo) {
      return res.json({
        zip_code: zipCode,
        valid: false,
        zip_valid: false,
        message: 'ZIP code not found',
        extraction_variables: { has_availability: false, total_appointments: 0 }
      });
    }

    const availability = await summarizeAvailabilityByState(zipInfo.state, zipInfo.state_abbreviation, zipInfo.timezone);

    const response = {
      zip_code: zipInfo.zip_code,
      valid: true,
      zip_valid: true,
      city: zipInfo.city,
      state: zipInfo.state,
      state_abbreviation: zipInfo.state_abbreviation,
      timezone: zipInfo.timezone,
      days_available: availability.daysAvailable,
      available_slots: availability.availableSlots,
      message: availability.daysAvailable > 0 ? `Found availability on ${availability.daysAvailable} day(s).` : 'No availability found.',
      extraction_variables: {
        city: zipInfo.city,
        state: zipInfo.state,
        total_appointments: availability.totalAppointments,
        has_availability: availability.totalAppointments > 0
      }
    };

    return res.json(response);
  } catch (error) {
    console.error(`[${requestId}] ZIP availability error:`, error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'webhook-zipcode-availability', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`ZIP Code Availability webhook listening on port ${PORT}`);
  console.log(`Webhook endpoint: POST /webhook/zipcode-availability`);
});