require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const db = require('./db');

const app = express();

// Global safety catchers to prevent unhandled promise rejections from abruptly killing the server
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// Middleware
app.use(cors());
app.use(express.json());

// Root Health Check Endpoint
app.get('/', (req, res) => {
  res.send('Elite Tailor API is running');
});

// Twilio Setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

// Nodemailer transport setup for admin notifications
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: Number(process.env.EMAIL_PORT) === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper function to clean phone numbers for wa.me links
function cleanPhoneNumber(phone) {
  return phone.replace(/\D/g, '');
}

// POST: Handle new booking submissions
app.post('/api/bookings', async (req, res) => {
  const { client_name, phone, email, service_type, notes } = req.body;

  // Validate required client inputs
  if (!client_name || !phone || !service_type) {
    return res.status(400).json({ error: 'Please provide all required fields.' });
  }

  // Automatically generate current Date and Time on submission
  const now = new Date();
  const autoBookingDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const autoBookingTime = now.toLocaleTimeString('en-US', { hour12: false }); // HH:MM:SS

  try {
    // 1. Save appointment to PostgreSQL
    const insertQuery = `
      INSERT INTO bookings (client_name, phone, email, service_type, booking_date, booking_time, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
      RETURNING id, created_at;
    `;
    const values = [
      client_name,
      phone,
      email || null,
      service_type,
      autoBookingDate,
      autoBookingTime,
      notes || '',
    ];

    const { rows } = await db.query(insertQuery, values);
    const bookingId = rows[0].id;

    // 2. Dispatch email notification in background
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const mailOptions = {
        from: `"Elite Tailor Bookings" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `New Fitting Request #${bookingId} - ${client_name}`,
        html: `
          <h2>New Fitting Consultation</h2>
          <p><strong>Booking ID:</strong> #${bookingId}</p>
          <p><strong>Client:</strong> ${client_name}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Email:</strong> ${email || 'Not provided'}</p>
          <p><strong>Service:</strong> ${service_type}</p>
          <p><strong>Submitted Date & Time:</strong> ${autoBookingDate} at ${autoBookingTime}</p>
          <p><strong>Notes:</strong> ${notes || 'None'}</p>
        `,
      };

      transporter.sendMail(mailOptions).catch((err) => {
        console.error('Email dispatch error:', err.message);
      });
    }

    // 3. Dispatch WhatsApp notification to Tailor via Twilio
    if (twilioClient && process.env.TWILIO_WHATSAPP_NUMBER && process.env.STUDIO_WHATSAPP_NUMBER) {
      const sanitizedPhone = cleanPhoneNumber(phone);
      const prefilledText = encodeURIComponent(
        `Hello ${client_name}, thank you for reaching out to Elite Tailor! Regarding your consultation request for ${service_type}...`
      );
      const waReplyUrl = `https://wa.me/${sanitizedPhone}?text=${prefilledText}`;

      const whatsappMessage = 
`🧵 *NEW FITTING REQUEST #${bookingId}* 🧵

👤 *Client:* ${client_name}
📞 *Phone:* ${phone}
📧 *Email:* ${email || 'Not provided'}
👗 *Service:* ${service_type}
📅 *Submitted:* ${autoBookingDate} at ${autoBookingTime}

📝 *Inquiry Details:*
${notes || 'None'}

───────────────────
💬 *TAP TO REPLY DIRECTLY TO CLIENT:*
${waReplyUrl}`;

      twilioClient.messages
        .create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: process.env.STUDIO_WHATSAPP_NUMBER,
          body: whatsappMessage,
        })
        .catch((err) => {
          console.error('Twilio WhatsApp dispatch error:', err.message);
        });
    }

    // 4. Return confirmation payload
    return res.status(201).json({
      message: 'Booking created successfully',
      bookingId,
    });
  } catch (error) {
    console.error('DATABASE INSERT ERROR:', error);
    return res.status(500).json({ error: error.message || 'Internal server error processing booking.' });
  }
});

// GET: Fetch all bookings (for Admin view)
app.get('/api/bookings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bookings ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    res.status(500).json({ error: 'Failed to retrieve bookings.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Elite Tailor server running on port ${PORT}`);
});