const { supabaseAdmin } = require('../../config/supabase');

async function getServices(req, res) {
  try {
    let query = supabaseAdmin.from('services').select('*').order('display_order', { ascending: true });
    
    if (req.query.active === 'true') query = query.eq('is_active', true);
    if (req.query.category) query = query.eq('category', req.query.category);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getServiceById(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin.from('services').select('*').eq('id', id).single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Service not found' });
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createService(req, res) {
  try {
    const serviceData = req.body;
    const { data, error } = await supabaseAdmin.from('services').insert([serviceData]).select().single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateService(req, res) {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    
    const { data, error } = await supabaseAdmin.from('services').update(updates).eq('id', id).select().single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Service not found' });
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteService(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('services').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Service deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getServices, getServiceById, createService, updateService, deleteService };