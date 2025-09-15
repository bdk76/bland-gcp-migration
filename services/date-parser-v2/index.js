const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const chrono = require('chrono-node');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

function addSpaces(text) {
  // Add a space before common time-related keywords if they are not preceded by a space.
  const keywords = ['next', 'last', 'this', 'tomorrow', 'today', 'week', 'day', 'month', 'year', 'morning', 'afternoon', 'evening', 'tonight', 'anytime'];
  let processedText = text;

  // Add a space before numbers
  processedText = processedText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  // Add a space after numbers
  processedText = processedText.replace(/(\d)([a-zA-Z])/g, '$1 $2');

  for (const keyword of keywords) {
    const regex = new RegExp(`([a-zA-Z0-9])(${keyword})`, 'gi');
    processedText = processedText.replace(regex, `$1 ${keyword}`);
  }

  return processedText;
}

app.post('/api/parse-date', (req, res) => {
  let { datetime_request, timezone } = req.body.data;
  console.log('original datetime_request:', datetime_request);
  datetime_request = addSpaces(datetime_request);
  console.log('datetime_request after addSpaces:', datetime_request);

  if (!datetime_request) {
    return res.status(400).json({
      error: 'Missing required field: datetime_request',
    });
  }

  if (datetime_request.toLowerCase().includes('lunchtime')) {
    datetime_request = datetime_request.toLowerCase().replace('lunchtime', '12:00 PM');
  }

  const referenceDate = new Date();
  console.log('referenceDate:', referenceDate);

  let parsedResult;
  const dayOfMonthMatch = datetime_request.match(/(?:the |on the )?(\d+)(st|nd|rd|th)?/);

  if (dayOfMonthMatch) {
    const day = parseInt(dayOfMonthMatch[1], 10);
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day);
    parsedResult = chrono.parse(date.toString(), referenceDate, { forwardDate: true });
  } else {
    parsedResult = chrono.parse(datetime_request, referenceDate, { forwardDate: true });
  }

  console.log('parsedResult:', parsedResult);

  if (parsedResult.length > 0) {
    console.log('parsedResult[0].text:', parsedResult[0].text);
    console.log('parsedResult[0].start:', parsedResult[0].start.date());
  }

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
