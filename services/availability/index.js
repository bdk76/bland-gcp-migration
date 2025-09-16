const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Using a more extensive mock data set for realistic testing
const MOCK_APPOINTMENTS = [
  // Today + 1 Day
  { date: moment().add(1, 'days').format('YYYY-MM-DD'), time_slot: "9AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-001" },
  { date: moment().add(1, 'days').format('YYYY-MM-DD'), time_slot: "2PM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-002" },
  
  // Today + 2 Days
  { date: moment().add(2, 'days').format('YYYY-MM-DD'), time_slot: "10AM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-003" },
  
  // Today + 3 Days
  { date: moment().add(3, 'days').format('YYYY-MM-DD'), time_slot: "11AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-005" },
  { date: moment().add(3, 'days').format('YYYY-MM-DD'), time_slot: "4PM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-004" },

  // Today + 7 Days
  { date: moment().add(7, 'days').format('YYYY-MM-DD'), time_slot: "9AM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-006" },
  { date: moment().add(7, 'days').format('YYYY-MM-DD'), time_slot: "10AM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-007" },
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Available slots endpoint - with improved fallback logic
app.post('/api/available-slots', (req, res) => {
  try {
    const { 
      start_date, 
      end_date, 
      provider_id, 
      limit = 5
    } = req.body;

    let appointments = [...MOCK_APPOINTMENTS];

    // --- Step 1: Perform the Specific Query ---
    let specificAppointments = appointments;

    // Filter future appointments only
    specificAppointments = specificAppointments.filter(apt => moment(apt.date).isSameOrAfter(moment(), 'day'));

    if (provider_id) {
      specificAppointments = specificAppointments.filter(apt => apt.provider_id === provider_id);
    }
    if (start_date) {
      specificAppointments = specificAppointments.filter(apt => apt.date === start_date);
    }
    if (end_date) {
      specificAppointments = specificAppointments.filter(apt => apt.date <= end_date);
    }

    let finalAppointments = specificAppointments.slice(0, limit);

    // --- Step 2: Perform a Broader, Fallback Query ---
    if (finalAppointments.length === 0) {
      console.log(`No exact matches found for start_date: ${start_date}. Performing broader search.`);
      
      let fallbackAppointments = appointments.filter(apt => moment(apt.date).isSameOrAfter(moment(), 'day'));

      if (provider_id) {
        fallbackAppointments = fallbackAppointments.filter(apt => apt.provider_id === provider_id);
      }
      
      // If a start_date was given, find the next available slots after that date
      if (start_date) {
        fallbackAppointments = fallbackAppointments.filter(apt => moment(apt.date).isAfter(start_date, 'day'));
      }

      finalAppointments = fallbackAppointments.slice(0, 3); // Return the next 3 available as a fallback
    }


    // Return the response
    res.json({
      has_slots: finalAppointments.length > 0,
      total_slots: finalAppointments.length,
      // The Bland flow expects 'best_slots', so we provide it.
      best_slots: finalAppointments 
    });

  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({
      error: 'Internal server error',
      has_slots: false,
      total_slots: 0,
      best_slots: []
    });
  }
});

// ... (other endpoints remain the same)

// Get providers endpoint
app.get('/api/providers', (req, res) => {
  const providers = [
    { provider_id: "123", name: "Dr. Smith", specialty: "General Practice" },
    { provider_id: "124", name: "Dr. Jones", specialty: "Pediatrics" },
    { provider_id: "125", name: "Dr. Williams", specialty: "Internal Medicine" }
  ];
  res.json({ providers: providers, total: providers.length });
});

// Get specific appointment details
app.get('/api/appointment/:appointmentId', (req, res) => {
  const appointment = MOCK_APPOINTMENTS.find(apt => apt.appointment_id === req.params.appointmentId);
  if (appointment) {
    res.json({ found: true, appointment: appointment });
  } else {
    res.status(404).json({ found: false, error: 'Appointment not found' });
  }
});

// Book appointment endpoint (mock)
app.post('/api/book-appointment', (req, res) => {
  const { appointment_id, patient_name, patient_id } = req.body;
  if (!appointment_id || !patient_name || !patient_id) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  res.json({
    success: true,
    booking: { confirmation_number: `CONF-${Date.now()}` }
  });
});

// Cancel appointment endpoint (mock)
app.post('/api/cancel-appointment', (req, res) => {
  const { appointment_id } = req.body;
  if (!appointment_id) {
    return res.status(400).json({ success: false, error: 'Missing appointment_id' });
  }
  res.json({ success: true });
});


// Start the server
app.listen(PORT, () => {
  console.log(`Appointment Availability service running on port ${PORT}`);
});

module.exports = app;