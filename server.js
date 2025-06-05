const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const auth = require('basic-auth');

const app = express();

// Supabase setup - USE ENVIRONMENT VARIABLES IN PRODUCTION
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Add validation to fail fast if missing
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration!');
  console.error(`SUPABASE_URL: ${supabaseUrl ? '***' : 'MISSING'}`);
  console.error(`SUPABASE_KEY: ${supabaseKey ? '***' : 'MISSING'}`);
  process.exit(1); // Crash immediately if not configured
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://*.onrender.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS', 'HEAD', 'DELETE']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// HEAD endpoint
app.head('/api/data', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).end();
});

// GET all bookings - with user emails fetched separately
// GET all bookings - with user emails fetched separately
// GET all bookings - with user emails fetched separately
app.get('/api/data', async (req, res) => {
  try {
    // First, get all bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        title,
        date,
        start_time,
        end_time,
        user_id
      `)
      .order('date', { ascending: true });

    if (bookingsError) throw bookingsError;
    
    // Get unique user IDs
    const userIds = [...new Set(bookings.map(booking => booking.user_id))];
    
    // Fetch user emails using the admin client
    const userEmails = {};
    for (const userId of userIds) {
      try {
        const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
        if (!userError && user) {
          userEmails[userId] = user.email;
        }
      } catch (err) {
        console.log(`Could not fetch user ${userId}:`, err.message);
        userEmails[userId] = 'Unknown User';
      }
    }
    
    // Transform to match frontend expectations
    const transformedData = bookings.map(item => ({
      id: item.id,
      title: item.title,
      date: item.date,
      startTime: item.start_time,
      endTime: item.end_time,
      userId: item.user_id,
      userEmail: userEmails[item.user_id] || 'Unknown User',
      userName: userEmails[item.user_id] ? userEmails[item.user_id].split('@')[0] : 'Unknown'
    }));
    
    res.setHeader('Cache-Control', 'no-cache');
    res.json(transformedData);
  } catch (err) {
    console.error('Supabase fetch error:', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

// POST new bookings - no need to store email separately
app.post('/api/data', async (req, res) => {
  try {
    // Get user info from auth header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
    if (authError) throw authError;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Data must be an array' });
    }

    const isValid = req.body.every(event => 
      event.title && 
      /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
      /^\d{2}:\d{2}$/.test(event.startTime) &&
      /^\d{2}:\d{2}$/.test(event.endTime)
    );

    if (!isValid) {
      return res.status(400).json({ 
        error: 'Invalid event structure',
        example: {
          title: "string",
          date: "YYYY-MM-DD",
          startTime: "HH:MM",
          endTime: "HH:MM"
        }
      });
    }

    // Prepare data for Supabase
    const supabaseData = req.body.map(event => ({
      id: event.id || Date.now(), // Generate ID if not provided
      title: event.title,
      date: event.date,
      start_time: event.startTime,
      end_time: event.endTime,
      user_id: user.id // Only store user_id, not email
    }));

    const { data, error } = await supabase
      .from('bookings')
      .upsert(supabaseData);

    if (error) throw error;
    res.json({ success: true, itemsSaved: req.body.length });
  } catch (err) {
    console.error('Supabase save error:', err);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// DELETE booking
app.delete('/api/data/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Supabase delete error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
