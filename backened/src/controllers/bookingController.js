// src/controllers/bookingController.js
const { supabase, supabaseAdmin } = require('../config/supabase');
const { AppError } = require('../middleware/errorHandler');

// Submit booking (public)
async function createBooking(req, res, next) {
  try {
    const bookingData = {
      ...req.body,
      user_ip: req.ip || req.connection.remoteAddress,
      user_agent: req.headers['user-agent'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'pending'
    };
    
    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingData])
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({ 
      success: true, 
      data,
      message: 'Booking submitted successfully. We will contact you within 2 hours.'
    });
  } catch (error) {
    next(error);
  }
}

// Get all bookings (admin only)
async function getAllBookings(req, res, next) {
  try {
    let query = supabaseAdmin
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Filter by status
    if (req.query.status) {
      query = query.eq('status', req.query.status);
    }
    
    // Date range filter
    if (req.query.from_date) {
      query = query.gte('event_date', req.query.from_date);
    }
    if (req.query.to_date) {
      query = query.lte('event_date', req.query.to_date);
    }
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    query = query.range(offset, offset + limit - 1);
    
    // Get total count
    const { count: totalCount, error: countError } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true });
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ 
      success: true, 
      data,
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        pages: Math.ceil((totalCount || 0) / limit)
      }
    });
  } catch (error) {
    next(error);
  }
}

// Get single booking (admin only)
async function getBooking(req, res, next) {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !data) {
      throw new AppError('Booking not found', 404);
    }
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Update booking status (admin only)
async function updateBookingStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status. Must be: pending, confirmed, completed, cancelled', 400);
    }
    
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({ 
        status, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    if (!data) throw new AppError('Booking not found', 404);
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Delete booking (admin only)
async function deleteBooking(req, res, next) {
  try {
    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from('bookings')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Booking deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// Get booking statistics (admin only)
async function getBookingStats(req, res, next) {
  try {
    // Get all bookings
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('status, created_at, event_date');
    
    if (error) throw error;
    
    // Calculate stats
    const stats = {
      total: data.length,
      pending: data.filter(b => b.status === 'pending').length,
      confirmed: data.filter(b => b.status === 'confirmed').length,
      completed: data.filter(b => b.status === 'completed').length,
      cancelled: data.filter(b => b.status === 'cancelled').length,
      // This month stats
      thisMonth: data.filter(b => {
        const now = new Date();
        const created = new Date(b.created_at);
        return created.getMonth() === now.getMonth() && 
               created.getFullYear() === now.getFullYear();
      }).length,
      // Upcoming events (event_date >= today)
      upcomingEvents: data.filter(b => {
        const today = new Date().toISOString().split('T')[0];
        return b.event_date >= today && b.status !== 'cancelled';
      }).length
    };
    
    // Monthly trend (last 6 months)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData = {};
    
    data.forEach(booking => {
      const date = new Date(booking.created_at);
      const monthKey = `${months[date.getMonth()]} ${date.getFullYear()}`;
      monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
    });
    
    const monthlyTrend = Object.entries(monthlyData)
      .slice(-6)
      .map(([month, count]) => ({ month, count }));
    
    res.json({ 
      success: true, 
      stats,
      monthlyTrend
    });
  } catch (error) {
    next(error);
  }
}

// Export all functions
module.exports = {
  createBooking,
  getAllBookings,
  getBooking,
  updateBookingStatus,
  deleteBooking,
  getBookingStats
};