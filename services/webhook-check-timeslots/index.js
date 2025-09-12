/**
 * Webhook 3: Check Available Time Slots
 * 
 * This webhook:
 * 1. Takes parsed date/time preferences
 * 2. Checks against available appointment slots
 * 3. Returns best matches ranked by proximity to requested time
 * 4. Handles timezone conversions
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const crypto = require('crypto');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID || 'bland-gcp-migration'
});

// Get webhook secret from environment
const WEBHOOK_SECRET = process.env.BLAND_WEBHOOK_SECRET || '';
const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

/**
 * Verify Bland webhook signature
 */
function verifyBlandWebhook(payload, signature) {
  if (SKIP_SIGNATURE) {
    console.log('Signature validation skipped (SKIP_SIGNATURE_VALIDATION=true)');
    return true;
  }

  if (!WEBHOOK_SECRET) {
    console.log('No webhook secret configured, skipping validation');
    return true;
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

/**
 * Calculate time difference in minutes
 */
function getTimeDifference(time1, time2) {
  const t1 = moment(time1, 'HH:mm');
  const t2 = moment(time2, 'HH:mm');
  return Math.abs(t1.diff(t2, 'minutes'));
}

/**
 * Score a slot based on how well it matches preferences
 */
function scoreSlot(slot, preferences) {
  let score = 100; // Start with perfect score
  
  const { date, time, timeRange } = preferences;
  
  // Date matching
  if (date && slot.date) {
    const slotDate = moment(slot.date);
    const prefDate = moment(date);
    const daysDiff = Math.abs(slotDate.diff(prefDate, 'days'));
    
    if (daysDiff === 0) {
      score += 50; // Exact date match bonus
    } else {
      score -= daysDiff * 10; // Penalty for each day difference
    }
  }
  
  // Time matching
  if (time && slot.time) {
    const timeDiff = getTimeDifference(slot.time, time);
    
    if (timeDiff === 0) {
      score += 30; // Exact time match bonus
    } else if (timeDiff <= 30) {
      score += 20; // Close time match
    } else if (timeDiff <= 60) {
      score += 10; // Reasonable time match
    } else {
      score -= Math.min(timeDiff / 10, 50); // Penalty for time difference
    }
  }
  
  // Time range matching
  if (timeRange && slot.time) {
    const slotTime = moment(slot.time, 'HH:mm');
    const rangeStart = moment(timeRange.start, 'HH:mm');
    const rangeEnd = moment(timeRange.end, 'HH:mm');
    
    if (slotTime.isBetween(rangeStart, rangeEnd, null, '[]')) {
      score += 25; // Within preferred time range
    } else {
      // Calculate how far outside the range
      const distToRange = Math.min(
        Math.abs(slotTime.diff(rangeStart, 'minutes')),
        Math.abs(slotTime.diff(rangeEnd, 'minutes'))
      );
      score -= Math.min(distToRange / 10, 30);
    }
  }
  
  return Math.max(0, score); // Don't go below 0
}

/**
 * Find best matching slots
 */
async function findBestSlots(state, stateAbbr, preferences, limit = 5) {
    const requestId = Date.now();
    console.log(`[${requestId}] Finding best slots for state: ${state}, preferences:`, preferences);

    try {
        const today = new Date().toISOString().split('T')[0];
        const stateValues = [state, stateAbbr, state?.toUpperCase(), stateAbbr?.toUpperCase()].filter(Boolean);

        let allSlots = [];
        let query;

        // --- Step 1: Perform the Specific Query ---
        if (preferences.date) {
            console.log(`[${requestId}] Step 1: Performing specific query for date: ${preferences.date}`);
            for (const stateValue of stateValues) {
                query = firestore.collection('doctor_scheduling')
                    .where('scheduledState', '==', stateValue)
                    .where('scheduledAvailable', '==', true)
                    .where('scheduledDate', '==', preferences.date);

                const querySnapshot = await query.get();
                if (!querySnapshot.empty) {
                    querySnapshot.forEach(doc => allSlots.push({ id: doc.id, ...doc.data() }));
                    console.log(`[${requestId}] Found ${querySnapshot.size} slots for state '${stateValue}' on ${preferences.date}`);
                    break; // Found slots for one state format, no need to check others
                }
            }
        }

        // --- Step 2: Perform a Broader, Fallback Query ---
        if (allSlots.length === 0) {
            console.log(`[${requestId}] Step 2: No specific matches found. Performing broader fallback query.`);
            for (const stateValue of stateValues) {
                query = firestore.collection('doctor_scheduling')
                    .where('scheduledState', '==', stateValue)
                    .where('scheduledAvailable', '==', true)
                    .where('scheduledDate', '>=', today)
                    .orderBy('scheduledDate') // Order by date to get the soonest
                    .limit(20); // Limit to a reasonable number for the fallback

                const querySnapshot = await query.get();
                if (!querySnapshot.empty) {
                    querySnapshot.forEach(doc => allSlots.push({ id: doc.id, ...doc.data() }));
                    console.log(`[${requestId}] Found ${querySnapshot.size} fallback slots for state '${stateValue}'`);
                    break; // Found slots for one state format, no need to check others
                }
            }
        }

        // Normalize and score the collected slots
        const normalizedSlots = allSlots.map(data => ({
            id: data.id,
            date: data.scheduledDate,
            time: data.scheduledTimeSlot,
            state: data.scheduledState,
            provider: data.scheduledProvider,
            appointmentId: data.athenaAppointmentId,
            available: data.scheduledAvailable,
            ...data
        })).filter(slot => slot.available);


        console.log(`[${requestId}] Total available slots found: ${normalizedSlots.length}`);

        // Score and sort slots
        const scoredSlots = normalizedSlots.map(slot => ({
            ...slot,
            score: scoreSlot(slot, preferences)
        }));

        // Sort by score (highest first) and take top matches
        scoredSlots.sort((a, b) => b.score - a.score);
        const bestMatches = scoredSlots.slice(0, limit);

        console.log(`[${requestId}] Best matches:`, bestMatches.map(s => ({
            date: s.date,
            time: s.time,
            score: s.score
        })));

        return bestMatches;

    } catch (error) {
        console.error(`[${requestId}] Error finding slots:`, error);
        throw error;
    }
}

/**
 * Main webhook endpoint
 */
app.post('/webhook/check-timeslots', async (req, res) => {
  const requestId = Date.now();
  console.log(`[${requestId}] Received timeslot check request`);
  
  try {
    // Verify signature
    const signature = req.headers['x-bland-signature'];
    const payload = JSON.stringify(req.body);
    
    if (!verifyBlandWebhook(payload, signature)) {
      console.log(`[${requestId}] Invalid webhook signature`);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    
    // Extract data from request
    const { data = {} } = req.body;
    
    // Get state information
    const state = data.state || data.State;
    const stateAbbr = data.state_abbreviation || data.state_abbr || data.stateAbbr;
    
    if (!state && !stateAbbr) {
      console.log(`[${requestId}] No state information provided`);
      return res.status(400).json({ 
        error: 'No state information provided',
        message: 'Please provide state information to check availability'
      });
    }
    
    // Get preferences
    const preferences = {
      date: data.preferred_date || data.date,
      time: data.preferred_time || data.time,
      timeRange: data.time_range || data.timeRange,
      timezone: data.timezone || 'America/New_York'
    };
    
    console.log(`[${requestId}] Checking slots for ${state} with preferences:`, preferences);
    
    // Find best matching slots
    const bestSlots = await findBestSlots(state, stateAbbr, preferences, 5);
    
    // Format slots for response
    const formattedSlots = bestSlots.map((slot, index) => {
      // Parse the time slot (e.g., "10 PM - 10:15 PM" -> use start time)
      let startTime = slot.time;
      if (slot.time && slot.time.includes('-')) {
        startTime = slot.time.split('-')[0].trim();
      }
      
      const slotMoment = moment.tz(
        `${slot.date} ${startTime}`,
        'YYYY-MM-DD h:mm A',
        preferences.timezone
      );
      
      return {
        rank: index + 1,
        date: slot.date,
        time: slot.time,
        time_slot: slot.time,
        // Align with Bland flow prompts
        natural_time: startTime,
        formatted_datetime: slotMoment.format('MMMM DD, YYYY [at] h:mm A'),
        day_of_week: slotMoment.format('dddd'),
        day_name: slotMoment.format('dddd'),
        provider: slot.provider,
        provider_id: slot.providerId || slot.scheduledProviderId || slot.provider_id || null,
        appointment_id: slot.appointmentId || slot.athenaAppointmentId || slot.appointment_id || null,
        location: slot.location,
        type: slot.type,
        score: slot.score,
        slot_id: slot.id
      };
    });
    
    // Create response
    const response = {
      success: bestSlots.length > 0,
      has_slots: bestSlots.length > 0,
      total_matches: bestSlots.length,
      best_slots: formattedSlots,
      message: bestSlots.length > 0
        ? `Found ${bestSlots.length} appointment slots matching your preferences. The best match is on ${formattedSlots[0].formatted_datetime}.`
        : 'No appointment slots found matching your preferences. Would you like to try different dates or times?',
      extraction_variables: {
        matches_found: bestSlots.length,
        best_match_date: formattedSlots[0]?.date,
        best_match_time: formattedSlots[0]?.time,
        best_match_formatted: formattedSlots[0]?.formatted_datetime,
        has_slots: bestSlots.length > 0
      }
    };
    
    console.log(`[${requestId}] Returning ${bestSlots.length} matches`);
    res.json(response);
    
  } catch (error) {
    console.error(`[${requestId}] Webhook error:`, error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'webhook-check-timeslots',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Timeslot Checker webhook listening on port ${PORT}`);
  console.log(`Webhook endpoint: POST /webhook/check-timeslots`);
  console.log(`Health check: GET /health`);
});
