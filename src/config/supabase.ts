import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Only load .env in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  const errorMsg = 'Missing Supabase configuration';
  console.error(errorMsg + ':');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
  
  // In production, log but don't crash the serverless function
  if (process.env.NODE_ENV === 'production') {
    console.error('Supabase configuration error in production - some features may not work');
  } else {
    throw new Error('Supabase URL and Anon Key must be provided in environment variables');
  }
}

if (process.env.NODE_ENV !== 'production') {
  console.log('Supabase configuration loaded successfully');
}

export const supabase = createClient(supabaseUrl!, supabaseKey!, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
  global: {
    headers: {
      'User-Agent': 'google-drive-clone/1.0.0'
    }
  }
});

// Test connection with better error handling
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    // Simple connection test that works with RLS policies
    const { data, error } = await supabase
      .from('users')
      .select('count', { count: 'exact' })
      .limit(1);
    
    if (error) {
      console.error('Supabase connection test failed:', error.message);
      return false;
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Supabase connection test successful');
    }
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Supabase connection test error:', errorMessage);
    return false;
  }
};

// Health check function for monitoring
export const getSupabaseHealth = async () => {
  const isConnected = await testSupabaseConnection();
  return {
    status: isConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    url: supabaseUrl ? 'configured' : 'missing',
    key: supabaseKey ? 'configured' : 'missing'
  };
};