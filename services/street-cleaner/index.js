const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const cleanStreetName = (rawStreet) => {
  if (!rawStreet || typeof rawStreet !== 'string') {
    return '';
  }

  let cleanedStreet = rawStreet.toLowerCase().trim();

  const abbreviations = {
    'st.': 'street',
    'st': 'street',
    'ave.': 'avenue',
    'ave': 'avenue',
    'rd.': 'road',
    'rd': 'road',
    'ln.': 'lane',
    'ln': 'lane',
    'dr.': 'drive',
    'dr': 'drive',
    'ct.': 'court',
    'ct': 'court',
    'pl.': 'place',
    'pl': 'place',
    'blvd.': 'boulevard',
    'blvd': 'boulevard',
    'n.': 'north',
    'n': 'north',
    's.': 'south',
    's': 'south',
    'e.': 'east',
    'e': 'east',
    'w.': 'west',
    'w': 'west'
  };

  // Replace abbreviations
  const words = cleanedStreet.split(' ');
  const newWords = words.map(word => abbreviations[word] || word);
  cleanedStreet = newWords.join(' ');

  // Title case the street name
  cleanedStreet = cleanedStreet.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });

  return cleanedStreet;
};

app.post('/clean-street', (req, res) => {
  const { street } = req.body;

  if (!street) {
    return res.status(400).json({ error: 'Missing required field: street' });
  }

  const cleanedStreet = cleanStreetName(street);

  res.json({ 
    original_street: street,
    cleaned_street: cleanedStreet,
    is_valid: true // For now, we'll assume all streets are valid after cleaning
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Street cleaning service running on port ${PORT}`);
});

module.exports = app;
