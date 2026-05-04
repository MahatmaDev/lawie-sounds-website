const { supabaseAdmin } = require('../../config/supabase');

async function getGallery(req, res) {
  try {
    let query = supabaseAdmin.from('gallery').select('*').order('created_at', { ascending: false });
    
    if (req.query.category) query = query.eq('category', req.query.category);
    if (req.query.limit) query = query.limit(parseInt(req.query.limit));
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createGalleryItem(req, res) {
  try {
    const itemData = { ...req.body, created_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from('gallery').insert([itemData]).select().single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteGalleryItem(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('gallery').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getGallery, createGalleryItem, deleteGalleryItem };