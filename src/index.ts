import express, { Express, Request, Response } from 'express';
import { supabase } from './config/supabase';

const app: Express = express();
const port: number = 3000;

app.get('/', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('users').select('*').limit(1);
    if (error) throw error;
    res.send(`Supabase connected! Users table data: ${JSON.stringify(data)}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).send(`Supabase connection error: ${errorMessage}`);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});