
import { Router } from 'express';
import { getSupabaseClient } from '../integrations/supabase';

const router = Router();
const supabase = getSupabaseClient();

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  res.json({ message: 'Login successful', data });
});

// Signup
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Signup successful', data });
});

// Get user profile
router.get('/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
    avatar: user.user_metadata?.avatar_url,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
  });
});

// Update user profile
router.put('/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];
  const { name, avatar_url } = req.body;

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { data, error } = await supabase.auth.updateUser({
    data: { name, avatar_url }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    id: data.user?.id,
    email: data.user?.email,
    name: data.user?.user_metadata?.name || data.user?.email?.split('@')[0] || 'User',
    avatar: data.user?.user_metadata?.avatar_url,
    updated_at: data.user?.updated_at,
  });
});

export default router;
