const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Main DOB normalization endpoint
app.post('/api/enhanced-dob-normalize', (req, res) => {
  try {
    const { raw_dob } = req.body;

    if (!raw_dob) {
      return res.status(400).json({
        error: 'Missing required field: raw_dob',
        type: 'unable_to_normalize'
      });
    }

    const normalizedDate = normalizeDateOfBirth(raw_dob);

    if (normalizedDate) {
      res.json({
        dob_iso: normalizedDate,
        type: 'success'
      });
    } else {
      res.json({
        dob_iso: null,
        type: 'unable_to_normalize'
      });
    }
  } catch (error) {
    console.error('Error processing DOB:', error);
    res.status(500).json({
      error: 'Internal server error',
      type: 'unable_to_normalize'
    });
  }
});

/**
 * Normalize various date of birth formats to ISO format (YYYY-MM-DD)
 * @param {string} rawDob - The raw date of birth string
 * @returns {string|null} - ISO formatted date or null if unable to parse
 */
function normalizeDateOfBirth(rawDob) {
  if (!rawDob || typeof rawDob !== 'string') {
    return null;
  }

  // Clean up the input
  let cleanedDob = rawDob.trim();

  // Handle spoken dates (convert words to numbers)
  cleanedDob = handleSpokenDates(cleanedDob);

  // Array of possible date formats to try
  const formats = [
    // Full month names
    'MMMM D YYYY',
    'MMMM DD YYYY',
    'MMMM D, YYYY',
    'MMMM DD, YYYY',
    'D MMMM YYYY',
    'DD MMMM YYYY',
    
    // Abbreviated month names
    'MMM D YYYY',
    'MMM DD YYYY',
    'MMM D, YYYY',
    'MMM DD, YYYY',
    'D MMM YYYY',
    'DD MMM YYYY',
    
    // Numeric formats with slashes
    'M/D/YYYY',
    'MM/DD/YYYY',
    'M/D/YY',
    'MM/DD/YY',
    'YYYY/MM/DD',
    'YYYY/M/D',
    
    // Numeric formats with dashes
    'M-D-YYYY',
    'MM-DD-YYYY',
    'M-D-YY',
    'MM-DD-YY',
    'YYYY-MM-DD',
    'YYYY-M-D',
    'DD-MM-YYYY',
    'D-M-YYYY',
    
    // Numeric formats with dots
    'M.D.YYYY',
    'MM.DD.YYYY',
    'M.D.YY',
    'MM.DD.YY',
    'DD.MM.YYYY',
    'D.M.YYYY',
    
    // ISO format (already normalized)
    'YYYY-MM-DD',
    
    // Other common formats
    'YYYYMMDD',
    'MMDDYYYY',
    'DDMMYYYY'
  ];

  // Try to parse with each format
  for (const format of formats) {
    const parsedDate = moment(cleanedDob, format, true);
    
    if (parsedDate.isValid()) {
      // Check if the year is reasonable (between 1900 and current year)
      const year = parsedDate.year();
      const currentYear = new Date().getFullYear();
      
      // Handle 2-digit years
      if (format.includes('YY') && !format.includes('YYYY')) {
        // If year is in the future, assume it's from the previous century
        if (year > currentYear) {
          parsedDate.subtract(100, 'years');
        }
      }
      
      // Validate the year range
      if (parsedDate.year() >= 1900 && parsedDate.year() <= currentYear) {
        return parsedDate.format('YYYY-MM-DD');
      }
    }
  }

  // Try parsing without strict format (last resort)
  const looseParsedDate = moment(cleanedDob);
  if (looseParsedDate.isValid()) {
    const year = looseParsedDate.year();
    const currentYear = new Date().getFullYear();
    
    if (year >= 1900 && year <= currentYear) {
      return looseParsedDate.format('YYYY-MM-DD');
    }
  }

  return null;
}

/**
 * Convert spoken date words to numbers
 * @param {string} dateStr - The date string potentially containing spoken numbers
 * @returns {string} - Date string with spoken numbers converted to digits
 */
function handleSpokenDates(dateStr) {
  const numberWords = {
    'first': '1', 'one': '1',
    'second': '2', 'two': '2',
    'third': '3', 'three': '3',
    'fourth': '4', 'four': '4',
    'fifth': '5', 'five': '5',
    'sixth': '6', 'six': '6',
    'seventh': '7', 'seven': '7',
    'eighth': '8', 'eight': '8',
    'ninth': '9', 'nine': '9',
    'tenth': '10', 'ten': '10',
    'eleventh': '11', 'eleven': '11',
    'twelfth': '12', 'twelve': '12',
    'thirteenth': '13', 'thirteen': '13',
    'fourteenth': '14', 'fourteen': '14',
    'fifteenth': '15', 'fifteen': '15',
    'sixteenth': '16', 'sixteen': '16',
    'seventeenth': '17', 'seventeen': '17',
    'eighteenth': '18', 'eighteen': '18',
    'nineteenth': '19', 'nineteen': '19',
    'twentieth': '20', 'twenty': '20',
    'twenty-first': '21', 'twenty first': '21', 'twenty one': '21',
    'twenty-second': '22', 'twenty second': '22', 'twenty two': '22',
    'twenty-third': '23', 'twenty third': '23', 'twenty three': '23',
    'twenty-fourth': '24', 'twenty fourth': '24', 'twenty four': '24',
    'twenty-fifth': '25', 'twenty fifth': '25', 'twenty five': '25',
    'twenty-sixth': '26', 'twenty sixth': '26', 'twenty six': '26',
    'twenty-seventh': '27', 'twenty seventh': '27', 'twenty seven': '27',
    'twenty-eighth': '28', 'twenty eighth': '28', 'twenty eight': '28',
    'twenty-ninth': '29', 'twenty ninth': '29', 'twenty nine': '29',
    'thirtieth': '30', 'thirty': '30',
    'thirty-first': '31', 'thirty first': '31', 'thirty one': '31'
  };

  let result = dateStr.toLowerCase();

  // Replace number words with digits
  for (const [word, digit] of Object.entries(numberWords)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, digit);
  }

  // Handle year words (nineteen ninety -> 1990)
  result = result.replace(/nineteen (\w+)/gi, (match, yearPart) => {
    const yearMap = {
      'hundred': '1900',
      'oh one': '1901', 'oh two': '1902', 'oh three': '1903', 'oh four': '1904',
      'oh five': '1905', 'oh six': '1906', 'oh seven': '1907', 'oh eight': '1908',
      'oh nine': '1909',
      'ten': '1910', 'eleven': '1911', 'twelve': '1912', 'thirteen': '1913',
      'fourteen': '1914', 'fifteen': '1915', 'sixteen': '1916', 'seventeen': '1917',
      'eighteen': '1918', 'nineteen': '1919',
      'twenty': '1920', 'thirty': '1930', 'forty': '1940', 'fifty': '1950',
      'sixty': '1960', 'seventy': '1970', 'eighty': '1980', 'ninety': '1990'
    };
    
    // Handle compound years like "ninety five" -> 1995
    if (yearPart.includes(' ')) {
      const parts = yearPart.split(' ');
      if (parts[0] in yearMap) {
        const decade = yearMap[parts[0]];
        const yearNum = parseInt(decade);
        if (parts[1] in numberWords) {
          return String(yearNum + parseInt(numberWords[parts[1]]));
        }
      }
    }
    
    return yearMap[yearPart] || match;
  });

  // Handle two thousand years
  result = result.replace(/two thousand( and)? (\w+)/gi, (match, and, yearPart) => {
    if (yearPart in numberWords) {
      return String(2000 + parseInt(numberWords[yearPart]));
    }
    // Handle "two thousand ten", "two thousand twenty", etc.
    const yearMap = {
      'ten': '2010', 'eleven': '2011', 'twelve': '2012', 'thirteen': '2013',
      'fourteen': '2014', 'fifteen': '2015', 'sixteen': '2016', 'seventeen': '2017',
      'eighteen': '2018', 'nineteen': '2019', 'twenty': '2020', 'twenty one': '2021',
      'twenty two': '2022', 'twenty three': '2023', 'twenty four': '2024'
    };
    return yearMap[yearPart] || match;
  });

  return result;
}

// Start the server
app.listen(PORT, () => {
  console.log(`DOB Normalization service running on port ${PORT}`);
  console.log(`Endpoint available at: http://localhost:${PORT}/api/enhanced-dob-normalize`);
});

module.exports = app;
