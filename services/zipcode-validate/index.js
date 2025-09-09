const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ZIP code validation endpoint
app.post('/api/zipcode-validated', (req, res) => {
  const { zip_code } = req.body;

  if (!zip_code) {
    return res.status(400).json({
      error: 'Missing required field: zip_code',
      valid: false,
    });
  }

  const cleanedZipCode = String(zip_code).trim().substring(0, 5);
  const zipCodeRegex = /^\d{5}$/;
  if (!zipCodeRegex.test(cleanedZipCode)) {
    return res.status(400).json({
      error: 'Invalid ZIP code format. Must be 5 digits.',
      valid: false,
    });
  }

  const zippopotamOptions = {
    hostname: 'api.zippopotam.us',
    path: `/us/${cleanedZipCode}`,
    method: 'GET'
  };

  const zippopotamReq = https.request(zippopotamOptions, (zippopotamRes) => {
    let data = '';
    zippopotamRes.on('data', (chunk) => {
      data += chunk;
    });
    zippopotamRes.on('end', () => {
      if (zippopotamRes.statusCode === 200) {
        const zipData = JSON.parse(data);
        const place = zipData.places[0];
        const latitude = place.latitude;
        const longitude = place.longitude;

        const timezonedbOptions = {
          hostname: 'api.timezonedb.com',
          path: `/v2.1/get-time-zone?key=FLFANMMUHHPI&format=json&by=position&lat=${latitude}&lng=${longitude}`,
          method: 'GET'
        };

        const timezonedbReq = https.request(timezonedbOptions, (timezonedbRes) => {
          let tzData = '';
          timezonedbRes.on('data', (chunk) => {
            tzData += chunk;
          });
          timezonedbRes.on('end', () => {
            if (timezonedbRes.statusCode === 200) {
              const timezoneData = JSON.parse(tzData);
              res.json({
                zip_code: zipData['post code'],
                valid: true,
                city: place['place name'],
                state_abbreviation: place['state abbreviation'],
                timezone: timezoneData.zoneName,
              });
            } else {
              res.status(500).json({
                error: 'Error from TimeZoneDB API.',
                valid: false,
              });
            }
          });
        });

        timezonedbReq.on('error', (error) => {
          console.error('Error calling TimeZoneDB API:', error);
          res.status(500).json({
            error: 'Internal server error while contacting TimeZoneDB API.',
            valid: false,
          });
        });

        timezonedbReq.end();

      } else if (zippopotamRes.statusCode === 404) {
        res.status(200).json({
          zip_code: cleanedZipCode,
          valid: false,
          message: 'ZIP code not found.',
        });
      } else {
        res.status(500).json({
          error: 'Error from ZIP code API.',
          valid: false,
        });
      }
    });
  });

  zippopotamReq.on('error', (error) => {
    console.error('Error calling ZIP code API:', error);
    res.status(500).json({
      error: 'Internal server error while contacting ZIP code API.',
      valid: false,
    });
  });

  zippopotamReq.end();
});

// Start the server
app.listen(PORT, () => {
  console.log(`ZIP Code Validation service running on port ${PORT}`);
  console.log(`Endpoint available at: http://localhost:${PORT}/api/zipcode-validated`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});

module.exports = app;