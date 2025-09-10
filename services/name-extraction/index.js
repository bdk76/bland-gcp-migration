const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const nlp = require('compromise');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/api/name-extraction', (req, res) => {
  const { fullName } = req.body;

  if (!fullName) {
    return res.status(400).json({
      error: 'Missing required field: fullName',
    });
  }

  let doc = nlp(fullName);
  let names = doc.people().json();
  console.log('doc:', JSON.stringify(doc.json()));
  console.log('names:', JSON.stringify(names));

  let firstName, lastName;

  if (names.length > 0) {
    // Assuming the first person found is the correct one
    let person = names[0];
    firstName = person.firstName;
    lastName = person.lastName;
  } else {
    const nameParts = fullName.trim().split(' ');
    if (nameParts.length > 1) {
      firstName = nameParts[0];
      lastName = nameParts[nameParts.length - 1];
    } else {
      firstName = nameParts[0];
      lastName = '';
    }
  }


  res.json({
    firstName,
    lastName,
  });
});

app.listen(PORT, () => {
  console.log(`Name Extraction service running on port ${PORT}`);
  console.log(`Endpoint available at: http://localhost:${PORT}/api/name-extraction`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});

module.exports = app;
