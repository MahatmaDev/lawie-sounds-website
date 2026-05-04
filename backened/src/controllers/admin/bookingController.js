const { supabaseAdmin } = require('../../config/supabase');

async function getBookings(req, res) {
  try {
    let query = supabaseAdmin.from('bookings').select('*').order('created_at', { ascending: false });
    
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.limit) query = query.limit(parseInt(req.query.limit));
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateBookingStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteBooking(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getBookingStats(req, res) {
  try {
    const { data, error } = await supabaseAdmin.from('bookings').select('status');
    if (error) throw error;
    
    const stats = {
      total: data.length,
      pending: data.filter(b => b.status === 'pending').length,
      confirmed: data.filter(b => b.status === 'confirmed').length,
      completed: data.filter(b => b.status === 'completed').length,
      cancelled: data.filter(b => b.status === 'cancelled').length
    };
    
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getBookings, updateBookingStatus, deleteBooking, getBookingStats };