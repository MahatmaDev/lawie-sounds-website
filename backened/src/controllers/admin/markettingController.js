const { supabaseAdmin } = require('../../config/supabase');

async function getMarketingBanners(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('marketing_banners')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createMarketingBanner(req, res) {
  try {
    const bannerData = { ...req.body, created_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from('marketing_banners').insert([bannerData]).select().single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateMarketingBanner(req, res) {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    
    const { data, error } = await supabaseAdmin
      .from('marketing_banners')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteMarketingBanner(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('marketing_banners').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleBannerStatus(req, res) {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    const { data, error } = await supabaseAdmin
      .from('marketing_banners')
      .update({ is_active })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getMarketingBanners, createMarketingBanner, updateMarketingBanner, deleteMarketingBanner, toggleBannerStatus };