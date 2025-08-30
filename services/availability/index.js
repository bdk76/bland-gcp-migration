const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Mock appointment data
const MOCK_APPOINTMENTS = [
  {
    date: "2024-01-15",
    time_slot: "9AM", // Using format without ":00" as per user preference [[memory:5341974]]
    provider: "Dr. Smith",
    provider_id: "123",
    appointment_id: "apt-001"
  },
  {
    date: "2024-01-15",
    time_slot: "2PM", // Using format without ":00" as per user preference [[memory:5341974]]
    provider: "Dr. Smith",
    provider_id: "123",
    appointment_id: "apt-002"
  },
  {
    date: "2024-01-16",
    time_slot: "10AM", // Using format without ":00" as per user preference [[memory:5341974]]
    provider: "Dr. Jones",
    provider_id: "124",
    appointment_id: "apt-003"
  },
  {
    date: "2024-01-16",
    time_slot: "3PM", // Using format without ":00" as per user preference [[memory:5341974]]
    provider: "Dr. Jones",
    provider_id: "124",
    appointment_id: "apt-004"
  },
  {
    date: "2024-01-17",
    time_slot: "11AM", // Using format without ":00" as per user preference [[memory:5341974]]
    provider: "Dr. Smith",
    provider_id: "123",
    appointment_id: "apt-005"
  }
];

// Extended mock data for more realistic testing
const EXTENDED_MOCK_APPOINTMENTS = [
  // Week 1
  { date: "2024-01-15", time_slot: "9AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-001" },
  { date: "2024-01-15", time_slot: "10AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-002" },
  { date: "2024-01-15", time_slot: "11AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-003" },
  { date: "2024-01-15", time_slot: "2PM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-004" },
  { date: "2024-01-15", time_slot: "3PM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-005" },
  
  { date: "2024-01-16", time_slot: "9AM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-006" },
  { date: "2024-01-16", time_slot: "10AM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-007" },
  { date: "2024-01-16", time_slot: "11AM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-008" },
  { date: "2024-01-16", time_slot: "2PM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-009" },
  { date: "2024-01-16", time_slot: "4PM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-010" },
  
  { date: "2024-01-17", time_slot: "8AM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-011" },
  { date: "2024-01-17", time_slot: "9AM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-012" },
  { date: "2024-01-17", time_slot: "10AM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-013" },
  { date: "2024-01-17", time_slot: "1PM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-014" },
  { date: "2024-01-17", time_slot: "3PM", provider: "Dr. Williams", provider_id: "125", appointment_id: "apt-015" },
  
  // Week 2
  { date: "2024-01-22", time_slot: "9AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-016" },
  { date: "2024-01-22", time_slot: "11AM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-017" },
  { date: "2024-01-22", time_slot: "2PM", provider: "Dr. Smith", provider_id: "123", appointment_id: "apt-018" },
  
  { date: "2024-01-23", time_slot: "10AM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-019" },
  { date: "2024-01-23", time_slot: "3PM", provider: "Dr. Jones", provider_id: "124", appointment_id: "apt-020" }
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Available slots endpoint - returns mock data
app.post('/api/available-slots', (req, res) => {
  try {
    const { 
      start_date, 
      end_date, 
      provider_id, 
      limit = 5, // Limiting to 5 options as per user preference [[memory:5341984]]
      extended = false 
    } = req.body;

    // Use extended mock data if requested, otherwise use the basic set
    let appointments = extended ? [...EXTENDED_MOCK_APPOINTMENTS] : [...MOCK_APPOINTMENTS];

    // Filter by provider if specified
    if (provider_id) {
      appointments = appointments.filter(apt => apt.provider_id === provider_id);
    }

    // Filter by date range if specified
    if (start_date) {
      appointments = appointments.filter(apt => apt.date >= start_date);
    }
    if (end_date) {
      appointments = appointments.filter(apt => apt.date <= end_date);
    }

    // Apply limit - maximum of 5 options as per user preference [[memory:5341984]]
    const effectiveLimit = Math.min(limit, 5);
    const limitedAppointments = appointments.slice(0, effectiveLimit);

    // Return the response
    res.json({
      has_slots: limitedAppointments.length > 0,
      total_slots: limitedAppointments.length,
      slots: limitedAppointments
    });

  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({
      error: 'Internal server error',
      has_slots: false,
      total_slots: 0,
      slots: []
    });
  }
});

// Get providers endpoint (additional utility endpoint)
app.get('/api/providers', (req, res) => {
  const providers = [
    { provider_id: "123", name: "Dr. Smith", specialty: "General Practice" },
    { provider_id: "124", name: "Dr. Jones", specialty: "Pediatrics" },
    { provider_id: "125", name: "Dr. Williams", specialty: "Internal Medicine" }
  ];
  
  res.json({
    providers: providers,
    total: providers.length
  });
});

// Get specific appointment details
app.get('/api/appointment/:appointmentId', (req, res) => {
  const { appointmentId } = req.params;
  
  // Find appointment in all mock data
  const allAppointments = [...MOCK_APPOINTMENTS, ...EXTENDED_MOCK_APPOINTMENTS];
  const appointment = allAppointments.find(apt => apt.appointment_id === appointmentId);
  
  if (appointment) {
    res.json({
      found: true,
      appointment: appointment
    });
  } else {
    res.status(404).json({
      found: false,
      error: 'Appointment not found',
      appointment: null
    });
  }
});

// Book appointment endpoint (mock - doesn't actually persist)
app.post('/api/book-appointment', (req, res) => {
  const { appointment_id, patient_name, patient_id } = req.body;
  
  if (!appointment_id || !patient_name || !patient_id) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: appointment_id, patient_name, patient_id'
    });
  }
  
  // Mock booking response
  res.json({
    success: true,
    booking: {
      confirmation_number: `CONF-${Date.now()}`,
      appointment_id: appointment_id,
      patient_name: patient_name,
      patient_id: patient_id,
      booked_at: new Date().toISOString()
    }
  });
});

// Cancel appointment endpoint (mock)
app.post('/api/cancel-appointment', (req, res) => {
  const { appointment_id, confirmation_number } = req.body;
  
  if (!appointment_id && !confirmation_number) {
    return res.status(400).json({
      success: false,
      error: 'Must provide either appointment_id or confirmation_number'
    });
  }
  
  // Mock cancellation response
  res.json({
    success: true,
    cancellation: {
      cancelled_at: new Date().toISOString(),
      appointment_id: appointment_id || 'unknown',
      confirmation_number: confirmation_number || 'unknown'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Appointment Availability service running on port ${PORT}`);
  console.log(`Main endpoint: http://localhost:${PORT}/api/available-slots`);
  console.log(`Providers list: http://localhost:${PORT}/api/providers`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
