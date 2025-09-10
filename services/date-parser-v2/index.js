const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

app.post('/api/parse-date', (req, res) => {
  const { datetime_request, timezone } = req.body.data;

  if (!datetime_request) {
    return res.status(400).json({
      error: 'Missing required field: datetime_request',
    });
  }

  // Create a reference date in the specified timezone.
  // This helps chrono-node to correctly interpret relative dates like "tomorrow".
  const referenceDate = new Date();

  const parsedResult = chrono.parse(datetime_request, {
      forwardDate: true,
  });

  if (parsedResult.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Could not parse the date/time. Please try a different format.',
    });
  }

  const result = parsedResult[0];

  const response = {
    success: true,
    parsed: {
      date: result.start.get('year') + '-' + (result.start.get('month')) + '-' + result.start.get('day'),
      time: result.start.get('hour') + ':' + result.start.get('minute') + ':' + result.start.get('second'),
      timezone: timezone,
      original: datetime_request,
      formatted: {
        date: result.start.date().toDateString(),
        time: result.start.date().toTimeString(),
      },
    },
    message: `Understood: ${result.text}`,
  };

  res.json(response);
});

app.listen(PORT, () => {
  console.log(`Date Parser v2 service running on port ${PORT}`);
  console.log(`Endpoint available at: http://localhost:${PORT}/api/parse-date`);
});

module.exports = app;
