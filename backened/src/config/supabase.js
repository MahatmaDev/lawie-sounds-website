// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client (for frontend/anonymous requests)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client (for backend operations with full access)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Test connection
async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    console.log('✅ Supabase connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    return false;
  }
}

module.exports = { supabase, supabaseAdmin, testSupabaseConnection };