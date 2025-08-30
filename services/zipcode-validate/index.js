const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Static ZIP code data
const ZIP_CODE_DATA = {
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
  '60601': {
    city: 'Chicago',
    state: 'Illinois',
    state_abbreviation: 'IL',
    timezone: 'America/Chicago'
  }
};

// Default data for unknown ZIP codes
const DEFAULT_DATA = {
  city: 'Unknown City',
  state: 'Unknown State',
  state_abbreviation: 'XX',
  timezone: 'America/New_York'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ZIP code validation endpoint
app.post('/api/zipcode-validated', (req, res) => {
  try {
    const { zip_code } = req.body;

    // Validate that zip_code was provided
    if (!zip_code) {
      return res.status(400).json({
        error: 'Missing required field: zip_code',
        data: null
      });
    }

    // Clean the ZIP code (remove spaces and convert to string)
    const cleanedZipCode = String(zip_code).trim();

    // Validate ZIP code format (5 digits or 5+4 format)
    const zipCodeRegex = /^\d{5}(-\d{4})?$/;
    if (!zipCodeRegex.test(cleanedZipCode)) {
      return res.status(400).json({
        error: 'Invalid ZIP code format. Must be 5 digits (e.g., 10001) or ZIP+4 format (e.g., 10001-1234)',
        data: null
      });
    }

    // Extract the 5-digit ZIP code (ignore +4 extension if present)
    const fiveDigitZip = cleanedZipCode.substring(0, 5);

    // Look up the ZIP code data
    const zipData = ZIP_CODE_DATA[fiveDigitZip] || DEFAULT_DATA;

    // Return the response with data
    res.json({
      data: {
        city: zipData.city,
        state: zipData.state,
        state_abbreviation: zipData.state_abbreviation,
        timezone: zipData.timezone
      }
    });

  } catch (error) {
    console.error('Error processing ZIP code validation:', error);
    res.status(500).json({
      error: 'Internal server error',
      data: null
    });
  }
});

// Additional endpoint to get all available ZIP codes (for testing/debugging)
app.get('/api/available-zipcodes', (req, res) => {
  const availableZipCodes = Object.keys(ZIP_CODE_DATA).map(zip => ({
    zip_code: zip,
    ...ZIP_CODE_DATA[zip]
  }));
  
  res.json({
    available_zip_codes: availableZipCodes,
    default_response: DEFAULT_DATA,
    note: 'Any ZIP code not in the available list will return the default response'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`ZIP Code Validation service running on port ${PORT}`);
  console.log(`Endpoint available at: http://localhost:${PORT}/api/zipcode-validated`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
  console.log(`Available ZIP codes list at: http://localhost:${PORT}/api/available-zipcodes`);
});

module.exports = app;
