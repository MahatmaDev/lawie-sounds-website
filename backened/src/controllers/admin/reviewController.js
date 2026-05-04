const { supabaseAdmin } = require('../../config/supabase');

async function getReviews(req, res) {
  try {
    let query = supabaseAdmin.from('reviews').select('*').order('created_at', { ascending: false });
    
    if (req.query.approved === 'true') query = query.eq('is_approved', true);
    if (req.query.approved === 'false') query = query.eq('is_approved', false);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function approveReview(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('reviews')
      .update({ is_approved: true })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteReview(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('reviews').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getReviews, approveReview, deleteReview };