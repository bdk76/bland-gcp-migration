const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
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

// Format appointment date endpoint
app.post('/api/format-appointment-date', (req, res) => {
  try {
    const { date, time, timezone } = req.body;

    // Validate required fields
    if (!date) {
      return res.status(400).json({
        error: 'Missing required field: date',
        formatted_date: null,
        formatted_time: null,
        confirmation_text: null
      });
    }

    // Set default timezone if not provided
    const tz = timezone || 'America/New_York';

    // Validate timezone
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        error: `Invalid timezone: ${timezone}. Please use a valid IANA timezone identifier.`,
        formatted_date: null,
        formatted_time: null,
        confirmation_text: null
      });
    }

    // Format the date and time
    const formattedData = formatAppointmentDateTime(date, time, tz);

    res.json(formattedData);

  } catch (error) {
    console.error('Error formatting appointment date:', error);
    res.status(500).json({
      error: 'Internal server error',
      formatted_date: null,
      formatted_time: null,
      confirmation_text: null
    });
  }
});

/**
 * Format appointment date and time
 * @param {string} date - Date in various formats
 * @param {string} time - Time in various formats (optional)
 * @param {string} timezone - IANA timezone identifier
 * @returns {object} - Formatted date, time, and confirmation text
 */
function formatAppointmentDateTime(date, time, timezone) {
  try {
    // Parse the date
    let appointmentMoment;
    
    if (time) {
      // Combine date and time if both provided
      const dateTimeString = `${date} ${time}`;
      appointmentMoment = moment.tz(dateTimeString, [
        'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DD h:mm A',
        'YYYY-MM-DD h:mm:ss A',
        'YYYY-MM-DD hA',
        'YYYY-MM-DD h A',
        'MM/DD/YYYY HH:mm',
        'MM/DD/YYYY h:mm A',
        'MM/DD/YYYY hA',
        'MM-DD-YYYY HH:mm',
        'MM-DD-YYYY h:mm A',
        'MM-DD-YYYY hA'
      ], timezone);
    } else {
      // Parse date only
      appointmentMoment = moment.tz(date, [
        'YYYY-MM-DD',
        'MM/DD/YYYY',
        'MM-DD-YYYY',
        'YYYY/MM/DD',
        'DD/MM/YYYY',
        'DD-MM-YYYY'
      ], timezone);
    }

    // Check if the date is valid
    if (!appointmentMoment.isValid()) {
      return {
        formatted_date: null,
        formatted_time: null,
        confirmation_text: 'Unable to parse the provided date',
        error: 'Invalid date format'
      };
    }

    // Format the date with ordinal suffix (e.g., "Thursday, January 15th")
    const dayOfWeek = appointmentMoment.format('dddd');
    const month = appointmentMoment.format('MMMM');
    const day = appointmentMoment.date();
    const dayWithOrdinal = addOrdinalSuffix(day);
    const year = appointmentMoment.year();
    
    // Create formatted date string
    const currentYear = moment().year();
    const formatted_date = year === currentYear 
      ? `${dayOfWeek}, ${month} ${dayWithOrdinal}`
      : `${dayOfWeek}, ${month} ${dayWithOrdinal}, ${year}`;

    // Format the time (without ":00" for on-the-hour times as per user preference) [[memory:5341974]]
    let formatted_time = null;
    if (time || appointmentMoment.hour() !== 0 || appointmentMoment.minute() !== 0) {
      const hour = appointmentMoment.hour();
      const minute = appointmentMoment.minute();
      
      if (minute === 0) {
        // Format without ":00" for on-the-hour times [[memory:5341974]]
        formatted_time = appointmentMoment.format('hA');
      } else {
        formatted_time = appointmentMoment.format('h:mm A');
      }
    }

    // Create confirmation text
    let confirmation_text;
    if (formatted_time) {
      confirmation_text = `Your appointment is scheduled for ${formatted_date} at ${formatted_time}`;
    } else {
      confirmation_text = `Your appointment is scheduled for ${formatted_date}`;
    }

    // Add timezone information if not in default timezone
    if (timezone !== 'America/New_York') {
      const tzAbbr = appointmentMoment.format('z');
      confirmation_text += ` (${tzAbbr})`;
    }

    return {
      formatted_date,
      formatted_time,
      confirmation_text
    };

  } catch (error) {
    console.error('Error in formatAppointmentDateTime:', error);
    return {
      formatted_date: null,
      formatted_time: null,
      confirmation_text: 'Error formatting date',
      error: error.message
    };
  }
}

/**
 * Add ordinal suffix to a day number
 * @param {number} day - Day of the month
 * @returns {string} - Day with ordinal suffix (e.g., "1st", "2nd", "3rd", "4th")
 */
function addOrdinalSuffix(day) {
  const j = day % 10;
  const k = day % 100;
  
  if (j === 1 && k !== 11) {
    return day + 'st';
  }
  if (j === 2 && k !== 12) {
    return day + 'nd';
  }
  if (j === 3 && k !== 13) {
    return day + 'rd';
  }
  return day + 'th';
}

// Additional endpoint for batch formatting
app.post('/api/format-appointment-dates-batch', (req, res) => {
  try {
    const { appointments, timezone } = req.body;

    if (!appointments || !Array.isArray(appointments)) {
      return res.status(400).json({
        error: 'Missing or invalid appointments array',
        formatted_appointments: []
      });
    }

    const tz = timezone || 'America/New_York';

    // Validate timezone
    if (!moment.tz.zone(tz)) {
      return res.status(400).json({
        error: `Invalid timezone: ${timezone}`,
        formatted_appointments: []
      });
    }

    const formatted_appointments = appointments.map(apt => {
      const formatted = formatAppointmentDateTime(apt.date, apt.time, tz);
      return {
        ...apt,
        ...formatted
      };
    });

    res.json({
      formatted_appointments,
      total: formatted_appointments.length
    });

  } catch (error) {
    console.error('Error in batch formatting:', error);
    res.status(500).json({
      error: 'Internal server error',
      formatted_appointments: []
    });
  }
});

// Get relative time description
app.post('/api/relative-time', (req, res) => {
  try {
    const { date, time, timezone } = req.body;

    if (!date) {
      return res.status(400).json({
        error: 'Missing required field: date',
        relative_time: null,
        is_past: null
      });
    }

    const tz = timezone || 'America/New_York';

    // Parse the date/time
    let targetMoment;
    if (time) {
      const dateTimeString = `${date} ${time}`;
      targetMoment = moment.tz(dateTimeString, [
        'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD h:mm A',
        'YYYY-MM-DD hA'
      ], tz);
    } else {
      targetMoment = moment.tz(date, 'YYYY-MM-DD', tz);
    }

    if (!targetMoment.isValid()) {
      return res.status(400).json({
        error: 'Invalid date format',
        relative_time: null,
        is_past: null
      });
    }

    const now = moment.tz(tz);
    const is_past = targetMoment.isBefore(now);
    
    // Get relative time description
    let relative_time;
    const diffDays = targetMoment.diff(now, 'days');
    const absDiffDays = Math.abs(diffDays);

    if (absDiffDays === 0) {
      relative_time = 'today';
    } else if (diffDays === 1) {
      relative_time = 'tomorrow';
    } else if (diffDays === -1) {
      relative_time = 'yesterday';
    } else if (diffDays > 0 && diffDays <= 7) {
      relative_time = `in ${diffDays} days`;
    } else if (diffDays < 0 && absDiffDays <= 7) {
      relative_time = `${absDiffDays} days ago`;
    } else if (diffDays > 7 && diffDays <= 14) {
      relative_time = 'next week';
    } else if (diffDays < -7 && absDiffDays <= 14) {
      relative_time = 'last week';
    } else if (diffDays > 14 && diffDays <= 30) {
      const weeks = Math.round(diffDays / 7);
      relative_time = `in ${weeks} weeks`;
    } else if (diffDays < -14 && absDiffDays <= 30) {
      const weeks = Math.round(absDiffDays / 7);
      relative_time = `${weeks} weeks ago`;
    } else {
      relative_time = targetMoment.fromNow();
    }

    res.json({
      relative_time,
      is_past,
      exact_date: targetMoment.format('YYYY-MM-DD'),
      exact_time: time ? targetMoment.format('h:mm A') : null
    });

  } catch (error) {
    console.error('Error calculating relative time:', error);
    res.status(500).json({
      error: 'Internal server error',
      relative_time: null,
      is_past: null
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Date Formatter service running on port ${PORT}`);
  console.log(`Main endpoint: http://localhost:${PORT}/api/format-appointment-date`);
  console.log(`Batch endpoint: http://localhost:${PORT}/api/format-appointment-dates-batch`);
  console.log(`Relative time: http://localhost:${PORT}/api/relative-time`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
